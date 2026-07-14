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
  extractText,
  lastHumanText,
  toErrorMessage,
  fenceUntrusted,
  usageFromExchange,
  sanitizeErrorForUser,
} from '../shared';
import { hasResearchMaterial } from './researcher';
import { buildReportPrompt } from '../prompts';

const DEFAULT_MAX_RETRIES = 3;

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

function formatFindings(findings: DeepResearchFinding[], perDigestCap: number): string {
  if (findings.length === 0) {
    return '(материал не собран)';
  }
  return findings
    .map((finding, i) => {
      const digest = finding.digest.slice(0, Math.max(1, perDigestCap));
      const sources =
        finding.sources.length > 0 ? `\nИсточники: ${finding.sources.join(', ')}` : '';
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const perDigestCap = Math.floor(digestCap / 2 ** attempt);
    try {
      const prompt = [
        new SystemMessage(buildReportPrompt({ request, brief, jurisdiction, now, nonce })),
        new HumanMessage(fenceUntrusted(formatFindings(findings, perDigestCap), nonce)),
      ];
      const response = await reportModel.invoke(prompt, { signal });
      const text = extractText(response).trim();
      if (text) {
        return { text, usage: usageFromExchange(prompt, response), fellBack: false };
      }
      return {
        text: buildFallbackReport({ reason: 'пустой ответ модели' }),
        usage: usageFromExchange(prompt, response),
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

export function buildNoDataReport(params: {
  request: string;
  findings: DeepResearchFinding[];
}): string {
  const attempted = params.findings
    .map((finding) => `- ${finding.subQuestion}`)
    .filter((line, index, all) => all.indexOf(line) === index)
    .join('\n');
  const flat = params.request.trim().replace(/\s+/g, ' ');
  const chars = [...flat];
  const shownRequest =
    chars.length > NO_DATA_REQUEST_CAP ? `${chars.slice(0, NO_DATA_REQUEST_CAP).join('')}…` : flat;
  return (
    `## Не удалось собрать материал\n\n` +
    `По запросу «${shownRequest}» веб-поиск не вернул пригодного материала: ` +
    `источники не открылись или поиск был недоступен. Отчёт без фактической базы не составлен.\n\n` +
    (attempted ? `Что исследовалось:\n${attempted}\n\n` : '') +
    `Что можно сделать: повторите исследование чуть позже или переформулируйте запрос. ` +
    `Если ошибка повторяется — сообщите администратору (похоже на сбой веб-поиска).`
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
        : buildNoDataReport({ request, findings: state.findings });
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
