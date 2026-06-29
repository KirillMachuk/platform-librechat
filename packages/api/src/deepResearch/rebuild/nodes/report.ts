import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
import { buildReportPrompt } from '../prompts';

const DEFAULT_MAX_RETRIES = 3;

/** Minimal invoke surface satisfied by a real chat model and by test fakes. */
export interface ReportModel {
  invoke(messages: BaseMessage[], options?: { signal?: AbortSignal }): Promise<BaseMessage | AIMessageChunk>;
}

export interface ReportNodeDeps {
  reportModel: BaseChatModel;
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted findings (H5). */
  nonce: string;
}

/** Maps the supervisor's stop reason to the run's finalize reason. The budget and
 *  round caps both yield a deliberate PARTIAL, kept distinct from a model-judged
 *  'completed' so the UI can label why gathering stopped. */
export function concludeToFinalize(reason: SupervisorConcludeReason | null): FinalizeReason {
  if (reason === 'budget') {
    return 'budget';
  }
  if (reason === 'rounds') {
    return 'rounds';
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
      const sources = finding.sources.length > 0 ? `\nИсточники: ${finding.sources.join(', ')}` : '';
      return `### Находка ${i + 1}: ${finding.subQuestion}\n${digest}${sources}`;
    })
    .join('\n\n');
}

/** Deterministic report assembled WITHOUT the model — the last-resort guarantee. */
export function buildFallbackReport(params: {
  brief: string;
  jurisdiction: string;
  findings: DeepResearchFinding[];
  reason: string;
}): string {
  const { brief, jurisdiction, findings, reason } = params;
  const header =
    `# Аналитическая записка (частичный отчёт)\n\n` +
    `Юрисдикция: ${jurisdiction || 'не определена'}\n` +
    `Запрос: ${brief}\n\n` +
    `> Примечание: отчёт собран автоматически из найденных материалов (генерация моделью недоступна: ${reason}).`;
  if (findings.length === 0) {
    return `${header}\n\nПо запросу не удалось собрать данные.`;
  }
  const body = findings
    .map((finding, i) => {
      // One source per line (Markdown list) rather than a comma-joined run: long URLs
      // wrap cleanly per-line on a ~380px mobile screen instead of overflowing.
      const sources =
        finding.sources.length > 0
          ? `\n\n**Источники:**\n${finding.sources.map((source) => `- ${source}`).join('\n')}`
          : '';
      return `## ${i + 1}. ${finding.subQuestion}\n${finding.digest}${sources}`;
    })
    .join('\n\n');
  return `${header}\n\n## Собранные материалы\n\n${body}`;
}

/**
 * Composes the final report with truncate-retry: on a context-limit error it
 * halves each finding's digest and retries (up to `maxRetries`); on any other
 * error, an empty response, or after exhausting retries, it returns a
 * deterministic fallback assembled from the findings. NEVER throws except on a
 * real abort (a control signal the run wrapper handles).
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
}): Promise<{ text: string; usage: Partial<DeepResearchTokenUsage> }> {
  const { reportModel, request, brief, jurisdiction, findings, digestCap, now, nonce, signal } = params;
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
        return { text, usage: usageFromExchange(prompt, response) };
      }
      return {
        text: buildFallbackReport({ brief, jurisdiction, findings, reason: 'пустой ответ модели' }),
        usage: usageFromExchange(prompt, response),
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (!isContextLimitError(error) || attempt === maxRetries) {
        return {
          text: buildFallbackReport({ brief, jurisdiction, findings, reason: sanitizeErrorForUser(error) }),
          usage: {},
        };
      }
    }
  }
  return {
    text: buildFallbackReport({ brief, jurisdiction, findings, reason: 'превышены лимиты контекста' }),
    usage: {},
  };
}

/**
 * REPORT — the terminal node. Always runs before END (no path skips it) and
 * always produces a `finalReport`: model output, or a deterministic fallback.
 */
export function createReportNode(deps: ReportNodeDeps): DeepResearchNode {
  return async function report(state, config): Promise<DeepResearchStateUpdate> {
    const request = lastHumanText(state.messages);
    const finalizeReason = concludeToFinalize(state.concludeReason);
    const { text, usage } = await composeReport({
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
      finalizeReason,
      messages: [new AIMessage(text)],
      tokenUsage: usage,
    };
  };
}
