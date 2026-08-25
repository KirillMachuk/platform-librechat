import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import { useMessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** Pre-plan Deep Research phases (emitted by deepResearchRun's emitDrPhase)
 *  rendered as a label swap inside the same shimmer; the ProgressCard stays
 *  hidden for these (RunningSlot gates on the same set) so exactly one
 *  waiting label is ever on screen. */
const DR_PHASE_LABELS = {
  prepare: 'com_ui_dr_phase_prepare',
  plan: 'com_ui_dr_phase_plan',
} as const;

/**
 * Shimmering «Thinking…» label shown while the latest reply has no content yet
 * (a non-reasoning model before its first token, or Deep Research before the
 * plan card). Replaces the pulsing dot (design book §6.12, round 22 item 5).
 * During a Deep Research run the label follows the run's pre-plan phase
 * («Готовлю агента» → «Думаю над планом») via the dr_progress atom — same
 * shimmer, different words (round 23, item 3). conversationId comes from
 * MessageContext (Part-level mounts) or the prop (ContentParts mounts outside
 * the provider); with neither, the atom subscription is inert and the generic
 * label shows. Visible only under a `.submitting` ancestor, mirroring the old
 * dot's gating; the two legacy EmptyText paths in Part.tsx (AGENT_UPDATE
 * tail, whitespace-only last part) are additionally gated on isSubmitting, so
 * a finished reply never keeps a shimmering label (round 24).
 */
const ThinkingIndicator = memo(({ conversationId }: { conversationId?: string | null }) => {
  const localize = useLocalize();
  const messageContext = useMessageContext();
  const convoKey = conversationId ?? messageContext.conversationId ?? '';
  const drProgress = useRecoilValue(store.drProgressByConvoId(convoKey));
  const phaseKey =
    drProgress != null ? DR_PHASE_LABELS[drProgress.phase as keyof typeof DR_PHASE_LABELS] : null;
  return (
    <span className="thinking-shimmer">{localize(phaseKey ?? 'com_ui_thinking_indicator')}</span>
  );
});

export default ThinkingIndicator;
