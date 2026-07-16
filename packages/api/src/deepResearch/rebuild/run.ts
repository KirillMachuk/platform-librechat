import { GraphRecursionError } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  FinalizeReason,
  DeepResearchState,
  DeepResearchFinding,
  DeepResearchNodeError,
  DeepResearchTokenUsage,
  DeepResearchConfigurable,
} from './state';
import type { CompiledDeepResearchGraph } from './graph';
import { extractText, sanitizeErrorForUser } from './shared';
import { buildFallbackReport } from './nodes/report';

const ZERO_USAGE: DeepResearchTokenUsage = { input: 0, output: 0, total: 0 };
const DEFAULT_RECURSION_LIMIT = 256;

/** Status updates surfaced to the UI as the run progresses. */
export interface DeepResearchProgress {
  type: 'scope' | 'research' | 'report';
  round?: number;
  subQuestion?: string;
  jurisdiction?: string;
}

export interface RunDeepResearchParams {
  graph: CompiledDeepResearchGraph;
  input: { messages: BaseMessage[] };
  configurable: DeepResearchConfigurable;
  /** External cancellation (e.g. client disconnect). */
  signal?: AbortSignal;
  /** Wall-clock safety cap in ms; <= 0 disables. The token budget is enforced in-graph. */
  wallClockMs: number;
  recursionLimit?: number;
  /** Streams the REPORT node's tokens (the controller wires this to on_message_delta SSE). */
  onToken?: (text: string) => void;
  /** Receives progress updates (researcher dispatch, report start) for UI status. */
  onProgress?: (progress: DeepResearchProgress) => void;
}

export interface RunDeepResearchResult {
  finalReport: string;
  /** Non-fatal node failures accumulated during the run — the runner LOGS these so a
   *  degraded run (dead search, failing model) is visible in ops, never silent. */
  errors: DeepResearchNodeError[];
  finalizeReason: FinalizeReason;
  usage: DeepResearchTokenUsage;
  findings: DeepResearchFinding[];
}

/** A report from the run's final/last state — the graph's own report, or a fallback. */
function resultFrom(
  values: DeepResearchState | undefined,
  finalizeReason: FinalizeReason,
  fallbackReason: string,
): RunDeepResearchResult {
  const finalReport = values?.finalReport || buildFallbackReport({ reason: fallbackReason });
  return {
    finalReport,
    finalizeReason: values?.finalReport
      ? (values.finalizeReason ?? finalizeReason)
      : finalizeReason,
    usage: values?.tokenUsage ?? ZERO_USAGE,
    findings: values?.findings ?? [],
    errors: values?.errors ?? [],
  };
}

/** Streams only the REPORT node's tokens to `onToken` (other nodes' model output is internal). */
function handleMessageChunk(data: unknown, onToken: (text: string) => void): void {
  if (!Array.isArray(data)) {
    return;
  }
  const [chunk, meta] = data as [BaseMessage, { langgraph_node?: string } | undefined];
  if (meta?.langgraph_node !== 'report') {
    return;
  }
  const text = extractText(chunk);
  if (text) {
    onToken(text);
  }
}

/** Derives UI progress from a per-node state update. */
function handleUpdate(data: unknown, onProgress: (progress: DeepResearchProgress) => void): void {
  if (!data || typeof data !== 'object') {
    return;
  }
  for (const [node, value] of Object.entries(data as Record<string, Partial<DeepResearchState>>)) {
    if (node === 'scope' && value.jurisdiction) {
      onProgress({ type: 'scope', jurisdiction: value.jurisdiction });
    } else if (node === 'supervisor' && value.currentSubQuestion) {
      onProgress({ type: 'research', round: value.round, subQuestion: value.currentSubQuestion });
    } else if (node === 'report') {
      onProgress({ type: 'report' });
    }
  }
}

/**
 * Runs a Deep Research graph and ALWAYS resolves with a report. Enforces one
 * combined AbortSignal (external client-disconnect + a wall-clock safety cap);
 * on abort/timeout/error it returns a partial report assembled from the last
 * streamed state — the run-level half of the "always reports" guarantee (the
 * in-graph terminal REPORT node is the other half). The token budget is enforced
 * inside the graph (budget gate), not here. When `onToken`/`onProgress` are
 * provided, the REPORT node's tokens stream out and progress is surfaced.
 */
export async function runDeepResearch(
  params: RunDeepResearchParams,
): Promise<RunDeepResearchResult> {
  const { graph, input, configurable, signal, wallClockMs, onToken, onProgress } = params;

  const timeoutController = new AbortController();
  const timer =
    wallClockMs > 0 ? setTimeout(() => timeoutController.abort(), wallClockMs) : undefined;
  timer?.unref?.();

  const signals = [signal, timeoutController.signal].filter((s): s is AbortSignal => Boolean(s));
  const combinedSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

  // A1: absolute deadline at which SUPERVISOR stops gathering and routes to REPORT,
  // reserving the rest of the wall-clock for synthesis — so the model writes the
  // report in time instead of the hard watchdog killing the run into a fallback.
  // Off (undefined) unless the ratio is strictly in (0, 1).
  const timeGateRatio = configurable.budget?.timeGateRatio ?? 0;
  const softDeadlineMs =
    wallClockMs > 0 && timeGateRatio > 0 && timeGateRatio < 1
      ? Date.now() + Math.floor(wallClockMs * timeGateRatio)
      : undefined;

  const streamMode: ('values' | 'updates' | 'messages')[] = ['values'];
  if (onProgress) {
    streamMode.push('updates');
  }
  if (onToken) {
    streamMode.push('messages');
  }

  const config = {
    configurable: { ...configurable, thread_id: configurable.runId, softDeadlineMs },
    signal: combinedSignal,
    recursionLimit: params.recursionLimit ?? DEFAULT_RECURSION_LIMIT,
    streamMode,
  };

  const finalizeForCancellation = (
    values: DeepResearchState | undefined,
  ): RunDeepResearchResult | null => {
    // User intent wins: a client Stop reports 'aborted' even if the wall-clock
    // watchdog also tripped in the same tick (L9), so the UI never mislabels a
    // deliberate Stop as a timeout.
    if (signal?.aborted) {
      return resultFrom(values, 'aborted', 'исследование остановлено');
    }
    if (timeoutController.signal.aborted) {
      return resultFrom(values, 'time', 'превышен лимит времени исследования');
    }
    return null;
  };

  let lastValues: DeepResearchState | undefined;
  try {
    for await (const [mode, data] of await graph.stream(input, config)) {
      if (mode === 'values') {
        lastValues = data as DeepResearchState;
      } else if (mode === 'messages' && onToken) {
        handleMessageChunk(data, onToken);
      } else if (mode === 'updates' && onProgress) {
        handleUpdate(data, onProgress);
      }
    }
    return (
      finalizeForCancellation(lastValues) ??
      resultFrom(lastValues, 'completed', 'отчёт не сформирован')
    );
  } catch (error) {
    const cancellation = finalizeForCancellation(lastValues);
    if (cancellation) {
      return cancellation;
    }
    // Recursion limit = the gather loop ran longer than the round cap should allow;
    // surface it as a deliberate round-capped partial, not a generic engine error (L8).
    if (error instanceof GraphRecursionError) {
      return resultFrom(lastValues, 'rounds', 'достигнут предел числа шагов исследования');
    }
    return resultFrom(
      lastValues,
      'error',
      `ошибка выполнения исследования: ${sanitizeErrorForUser(error)}`,
    );
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
