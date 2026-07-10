import { useRecoilValue } from 'recoil';
import ProgressCard from './ProgressCard';
import store from '~/store';

/**
 * The single subscriber to the live `dr_progress` atom (task #21). ContentRender mounts
 * this ONLY on the active (latest, still-generating) assistant message, so a progress
 * event re-renders exactly one slot — not every message in the conversation (the atom
 * subscription bypasses ContentRender's memo comparator, so subscribing there would
 * re-render the whole transcript on each snapshot). Renders nothing outside a DR run.
 */
export default function RunningSlot({ conversationId }: { conversationId?: string | null }) {
  const drProgress = useRecoilValue(store.drProgressByConvoId(conversationId ?? ''));
  if (drProgress == null) {
    return null;
  }
  return <ProgressCard data={drProgress} />;
}
