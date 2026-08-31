import { useRecoilValue } from 'recoil';
import ProgressCard from './ProgressCard';
import store from '~/store';

/**
 * Subscriber to the live `dr_progress` atom (task #21; ThinkingIndicator also
 * reads it for the pre-plan label swap). ContentRender mounts
 * this ONLY on the active (latest, still-generating) assistant message, so a progress
 * event re-renders exactly one slot — not every message in the conversation (the atom
 * subscription bypasses ContentRender's memo comparator, so subscribing there would
 * re-render the whole transcript on each snapshot). Renders nothing outside a DR run.
 */
export default function RunningSlot({ conversationId }: { conversationId?: string | null }) {
  const drProgress = useRecoilValue(store.drProgressByConvoId(conversationId ?? ''));
  /* A run WITH an approved plan is drawn by the plan card itself (r26,
   * owner: one card, not two) — the snapshot carries that plan's steps, and
   * their presence is exactly what tells the two runs apart. A PROCEED run
   * (no plan card anywhere) still needs this standalone card. */
  if ((drProgress?.steps?.length ?? 0) > 0) {
    return null;
  }
  if (drProgress == null || drProgress.phase === 'prepare' || drProgress.phase === 'plan') {
    // Pre-plan phases render as the ThinkingIndicator's label swap — one
    // waiting label on screen, never a premature checklist card (round 23).
    return null;
  }
  return <ProgressCard data={drProgress} />;
}
