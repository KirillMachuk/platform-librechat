import { atomFamily } from 'recoil';

/**
 * Live Deep Research progress snapshot carried by the `dr_progress` SSE event
 * (task #21). Emitted by the runner during a research run; the plan card's running
 * state renders from it. `steps` are the approved plan steps (empty when there was
 * no plan, e.g. a PROCEED run); `progress` is a coarse 0..1 fraction.
 */
export interface TDeepResearchProgress {
  phase: 'scope' | 'research' | 'report' | string;
  steps: string[];
  action: string;
  searches: number;
  progress: number;
  /** Set by useResumableSSE while the stream is offline/reconnecting — the card swaps
   *  its action line for a "waiting for network" notice instead of pulsing as healthy. */
  stalled?: boolean;
}

/**
 * Latest `dr_progress` snapshot per conversation, or null when no DR run is active.
 * Written by `useResumableSSE` on each dr_progress event and cleared on the final
 * event; read by the Deep Research progress card. Keyed by conversationId so it
 * survives the message-tree rebuilds that recreate message objects each stream tick.
 */
export const drProgressByConvoId = atomFamily<TDeepResearchProgress | null, string>({
  key: 'drProgressByConvoId',
  default: null,
});

export default { drProgressByConvoId };
