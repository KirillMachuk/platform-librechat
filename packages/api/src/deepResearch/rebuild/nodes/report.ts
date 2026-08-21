import { logger } from '@librechat/data-schemas';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type {
  FinalizeReason,
  DeepResearchFinding,
  DeepResearchTokenUsage,
  DeepResearchStateUpdate,
  SupervisorConcludeReason,
} from '../state';
import type { DeepResearchTier } from '../config';
import type { DeepResearchNode } from '../graph';
import {
  readAnswer,
  lastHumanText,
  mergeUsage,
  toErrorMessage,
  fenceUntrusted,
  usageFromExchange,
  sanitizeErrorForUser,
} from '../shared';
import { hasResearchMaterial } from './researcher';
import { buildReportPrompt } from '../prompts';

const DEFAULT_MAX_RETRIES = 3;
/**
 * Sources listed per finding on the FIRST attempt — matches the researcher's own extraction
 * cap, so attempt 0 is byte-identical to before and no healthy run loses a citation.
 */
const SOURCES_PER_FINDING = 50;

/** Minimal invoke surface satisfied by a real chat model and by test fakes. */
export interface ReportModel {
  invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<BaseMessage | AIMessageChunk>;
}

export interface ReportNodeDeps {
  reportModel: BaseChatModel;
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted findings (H5). */
  nonce: string;
}

/** Maps the supervisor's stop reason to the run's finalize reason. Every branch here ends
 *  in a REAL model-written report — the gates all reserve a synthesis window, so none of
 *  them is a degradation (PR-2: there are no partial reports). Budget and round caps keep
 *  their own reason: they fire rarely and mark a report whose GATHERING was cut short, which
 *  is the one case the UI still flags as possibly incomplete. The TIME gate (A1) instead
 *  maps to 'completed': it fires on most healthy runs (gathering usually fills the time
 *  budget) and is the designed hand-off to synthesis, not a truncation. A genuine time
 *  DEGRADATION only comes from the hard wall-clock watchdog in the run wrapper, which sets
 *  'time' directly — and that outcome carries an honest notice, never a report. */
export function concludeToFinalize(reason: SupervisorConcludeReason | null): FinalizeReason {
  if (reason === 'budget') {
    return 'budget';
  }
  if (reason === 'rounds') {
    return 'rounds';
  }
  if (reason === 'error') {
    return 'error';
  }
  return 'completed';
}

function isContextLimitError(error: unknown): boolean {
  return /context|token|length|maximum|too long|413|payload too large/i.test(toErrorMessage(error));
}

/**
 * Renders the findings REPORT synthesises from, shrunk to `perDigestCap` / `perFindingSources`.
 *
 * BOTH halves shrink on a retry. Only the digest used to: a run with many findings could enter
 * the third attempt at an eighth of its evidence while carrying its full source lists — so the
 * model saw the URLs of facts whose text had been cut away, and wrote the report from what was
 * left. It was still returned as a normal 'completed' report, with nothing to say it had been
 * written from a fraction of the material.
 */
function formatFindings(
  findings: DeepResearchFinding[],
  perDigestCap: number,
  perFindingSources: number,
): string {
  if (findings.length === 0) {
    return '(материал не собран)';
  }
  return findings
    .map((finding, i) => {
      const digest = finding.digest.slice(0, Math.max(1, perDigestCap));
      const shown = finding.sources.slice(0, Math.max(1, perFindingSources));
      const sources = shown.length > 0 ? `\nИсточники: ${shown.join(', ')}` : '';
      return `### Находка ${i + 1}: ${finding.subQuestion}\n${digest}${sources}`;
    })
    .join('\n\n');
}

/**
 * Honest short notice for when a real report could NOT be produced — the synthesis model
 * failed, or the hard watchdog killed the run before REPORT. It deliberately does NOT dump
 * the raw findings: a half-synthesised digest list has no analytical value and misleads
 * (owner decision 2026-07-13 — no partial reports). The user is told to retry or narrow the
 * query instead. Echoes neither the brief nor the dialogue (which can embed the plan).
 */
export function buildFallbackReport(params: { reason: string }): string {
  return (
    `## Не удалось сформировать отчёт\n\n` +
    `Исследование не удалось довести до готового отчёта: ${params.reason}. ` +
    `Черновые материалы не сведены в отчёт — неполная выжимка только ввела бы в заблуждение.\n\n` +
    `Что можно сделать: повторите исследование или сузьте запрос — конкретнее по теме, региону или периоду.`
  );
}

/**
 * Composes the final report with truncate-retry: on a context-limit error it
 * halves each finding's digest and retries (up to `maxRetries`). On any other
 * error, an empty response, or after exhausting retries, it returns the honest
 * "couldn't produce a report" notice with `fellBack: true` — the caller maps that
 * to an 'error' outcome so a failed synthesis is never saved as a report. NEVER
 * throws except on a real abort (a control signal the run wrapper handles).
 */
export async function composeReport(params: {
  reportModel: ReportModel;
  request: string;
  brief: string;
  jurisdiction: string;
  findings: DeepResearchFinding[];
  digestCap: number;
  now: string;
  nonce: string;
  signal?: AbortSignal;
  maxRetries?: number;
}): Promise<{ text: string; usage: Partial<DeepResearchTokenUsage>; fellBack: boolean }> {
  const { reportModel, request, brief, jurisdiction, findings, digestCap, now, nonce, signal } =
    params;
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  /** Tokens burnt by attempts that returned nothing — billed, so they must be reported. */
  let spentOnEmpty: DeepResearchTokenUsage = { input: 0, output: 0, total: 0 };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const perDigestCap = Math.floor(digestCap / 2 ** attempt);
    const perFindingSources = Math.max(1, Math.ceil(SOURCES_PER_FINDING / 2 ** attempt));
    try {
      const prompt = [
        new SystemMessage(buildReportPrompt({ request, brief, jurisdiction, now, nonce })),
        new HumanMessage(
          fenceUntrusted(formatFindings(findings, perDigestCap, perFindingSources), nonce),
        ),
      ];
      const response = await reportModel.invoke(prompt, { signal });
      const answer = readAnswer('report', response);
      /**
       * A CUT answer is not a report. It used to be returned as one: on 2026-08-20 the
       * user received 1013 characters ending mid-word, with no error and no marker —
       * the node only asked whether there was text. Truncation takes the same path as an
       * empty answer, and for the same reason: halving the digest cap frees output budget,
       * which is exactly what a run that hit the ceiling needs.
       */
      if (!answer.empty && !answer.truncated) {
        /**
         * WHICH model actually wrote the report. The tier names a lead model, but the request
         * can still carry an OpenRouter fallback list inherited from the chat's model card,
         * and OpenRouter may answer from it — so "the slug the run intended" and "the slug
         * that answered" are two different facts, and only the first was ever recorded. That
         * makes "why is this report weaker than usual?" unanswerable after the fact.
         */
        const answeredBy = (response.response_metadata as { model_name?: unknown } | undefined)
          ?.model_name;
        logger.info(`[deepResearch:report] written by ${String(answeredBy ?? 'unknown')}`);
        return { text: answer.text, usage: usageFromExchange(prompt, response), fellBack: false };
      }
      /**
       * Both degradations take the SAME path, and both were found the expensive way:
       *   - EMPTY skipped the retry loop entirely and handed the user a fallback notice —
       *     a run that had gathered 7 findings and 355k tokens was thrown away on one
       *     silent non-answer;
       *   - CUT was returned as a finished report — 1013 characters ending mid-word.
       * Halving the digest cap answers both: an oversized prompt is the likeliest reason a
       * model returns nothing without raising a context error, and it is by definition the
       * reason it runs out of output budget. Even when the emptiness is the provider's own
       * intermittent one, a second attempt costs one call against losing the research.
       *
       * Usage from the discarded attempt is still counted: the call was billed.
       */
      spentOnEmpty = mergeUsage(spentOnEmpty, usageFromExchange(prompt, response));
      if (attempt < maxRetries) {
        continue;
      }
      return {
        text: buildFallbackReport({
          reason: answer.truncated ? 'ответ модели оборван' : 'пустой ответ модели',
        }),
        usage: spentOnEmpty,
        fellBack: true,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (!isContextLimitError(error) || attempt === maxRetries) {
        return {
          text: buildFallbackReport({ reason: sanitizeErrorForUser(error) }),
          usage: {},
          fellBack: true,
        };
      }
    }
  }
  return {
    text: buildFallbackReport({ reason: 'превышены лимиты контекста' }),
    usage: {},
    fellBack: true,
  };
}

/**
 * Honest short notice when the gather loop produced NO usable material (dead
 * search/scraper): deterministic, no model call — the model would only dress the
 * emptiness up as a fake analytical note full of «нет данных».
 */
/** Cap for the request echo inside the no-data notice: a clarify continuation's
 *  "request" is the whole dialogue transcript — echoing it verbatim is unreadable. */
const NO_DATA_REQUEST_CAP = 160;

/** Stop reasons that mean "the run's allowance ran out", not "the search failed". */
const EXHAUSTED_REASONS: readonly SupervisorConcludeReason[] = ['budget', 'rounds', 'time'];

export function buildNoDataReport(params: {
  request: string;
  findings: DeepResearchFinding[];
  /** Why the gather loop stopped — decides which cause the notice names. */
  reason?: SupervisorConcludeReason | null;
}): string {
  const attempted = params.findings
    .map((finding) => `- ${finding.subQuestion}`)
    .filter((line, index, all) => all.indexOf(line) === index)
    .join('\n');
  const flat = params.request.trim().replace(/\s+/g, ' ');
  const chars = [...flat];
  const shownRequest =
    chars.length > NO_DATA_REQUEST_CAP ? `${chars.slice(0, NO_DATA_REQUEST_CAP).join('')}…` : flat;
  /**
   * The cause has to be named correctly, because the notice tells the user what to DO next.
   * A run that simply ran out of its time/token/round allowance before gathering anything was
   * told the web search had failed, and sent to an administrator to debug a search that works
   * — while the one action that would actually help, narrowing the query, went unmentioned.
   */
  const exhausted = params.reason != null && EXHAUSTED_REASONS.includes(params.reason);
  const cause = exhausted
    ? `исследование не успело собрать материал: закончился отведённый на прогон лимит ` +
      `(время, бюджет или число кругов поиска)`
    : `веб-поиск не вернул пригодного материала: источники не открылись или поиск был недоступен`;
  const next = exhausted
    ? `Что можно сделать: сузьте запрос — конкретнее по теме, региону или периоду. ` +
      `Более узкий вопрос укладывается в лимит прогона.`
    : `Что можно сделать: повторите исследование чуть позже или переформулируйте запрос. ` +
      `Если ошибка повторяется — сообщите администратору (похоже на сбой веб-поиска).`;
  return (
    `## Не удалось собрать материал\n\n` +
    `По запросу «${shownRequest}» ${cause}. Отчёт без фактической базы не составлен.\n\n` +
    (attempted ? `Что исследовалось:\n${attempted}\n\n` : '') +
    next
  );
}

/**
 * REPORT — the terminal node. Always runs before END (no path skips it) and
 * always produces a `finalReport`: model output, or a deterministic fallback.
 * When the run gathered NO usable material, it refuses to fake an analytical
 * note: a short honest notice ships instead ('nodata', or 'error' when the
 * supervisor itself failed).
 */
export function createReportNode(deps: ReportNodeDeps): DeepResearchNode {
  return async function report(state, config): Promise<DeepResearchStateUpdate> {
    const request = lastHumanText(state.messages);
    const finalizeReason = concludeToFinalize(state.concludeReason);
    if (!state.findings.some(hasResearchMaterial)) {
      const supervisorFailed = state.concludeReason === 'error';
      const text = supervisorFailed
        ? buildFallbackReport({ reason: 'внутренняя ошибка оркестратора' })
        : buildNoDataReport({ request, findings: state.findings, reason: state.concludeReason });
      return {
        finalReport: text,
        finalizeReason: supervisorFailed ? 'error' : 'nodata',
        messages: [new AIMessage(text)],
      };
    }
    const { text, usage, fellBack } = await composeReport({
      reportModel: deps.reportModel,
      request,
      brief: state.researchBrief,
      jurisdiction: state.jurisdiction,
      findings: state.findings,
      digestCap: deps.tier.digestCap,
      now: deps.now,
      nonce: deps.nonce,
      signal: config.signal,
    });
    return {
      finalReport: text,
      // A failed synthesis (`fellBack`) is an 'error' outcome — the honest notice, never
      // saved as a report/PDF. A real model report keeps the concluded reason.
      finalizeReason: fellBack ? 'error' : finalizeReason,
      messages: [new AIMessage(text)],
      tokenUsage: usage,
    };
  };
}
