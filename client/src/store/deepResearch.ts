import { atomFamily } from 'recoil';
import { createStorageAtom } from './jotai-utils';

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
  /**
   * Which plan step the run is on, 0-based, as reported BY THE RUN (the
   * supervisor names the step its batch advances; the runner clamps it and
   * never lets it go backwards). Absent = the server does not know — a PROCEED
   * run, or a snapshot from before r27 — and the card must not invent one:
   * deriving it from `progress` is exactly the defect this replaced, which
   * ticked off two steps of a five-step plan on the first research round.
   */
  stepIndex?: number;
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

/**
 * «Запускать исследование сразу» (Settings → Chat; r30, owner 02.09). Replaces the plan
 * card's 30-second autostart: the card now waits for a click for as long as it takes, and
 * with this on it starts itself the moment a plan lands live. Listed in
 * `userPreferenceDefinitions`, so it follows the account onto the next device like every
 * other switch on the Chat tab (review r30, В1: it was the one that would not have).
 */
export const drAutoStartAtom = createStorageAtom<boolean>('drAutoStart', false);

/**
 * Plan messages whose FINAL event this tab processed (`finalHandler` marks them, the plan
 * card spends the mark). This is what separates a plan that JUST ARRIVED from one loaded
 * from history: the self-start may only ever fire on the former — reopening an old,
 * unstarted plan must never launch a research nobody asked for today. One mark permits
 * one decision; whatever the card decides (start, or stand down for a draft in the
 * composer, or a refusal), the mark is gone, so a later remount or a later flip of the
 * setting cannot start a plan that has been waiting.
 */
const plansArrivedLive = new Set<string>();

export function markPlanArrivedLive(messageId: string): void {
  plansArrivedLive.add(messageId);
}

export function planArrivedLive(messageId: string): boolean {
  return plansArrivedLive.has(messageId);
}

/** Spends the mark; true only for the first caller. */
export function consumePlanArrivedLive(messageId: string): boolean {
  return plansArrivedLive.delete(messageId);
}

export default { drProgressByConvoId };
