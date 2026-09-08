import { ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import styles from '~/components/Chat/Cards/ApprovalCard.module.css';
import { useChatContext } from '~/Providers';
import { Square } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * «Остановить исследование» — the one control that stops a live run, in the
 * frame's own header slot (the same 24px box and 12px inset as the plan card's
 * ✕: «two cards, one product», r26). Built once for both live cards; it used
 * to be assembled in full in each (design review 02.09, В6).
 */
export default function RunStopAction() {
  const localize = useLocalize();
  const { stopGenerating } = useChatContext();
  return (
    <ApprovalCardHeaderAction
      label={localize('com_ui_deep_research_stop')}
      onClick={stopGenerating}
      testId="dr-stop"
    >
      <Square className={`${styles.headActionIconSolid} fill-current`} aria-hidden="true" />
    </ApprovalCardHeaderAction>
  );
}
