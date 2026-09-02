import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useAtomValue } from 'jotai';
import { useToastContext } from '@librechat/client';
import { parseDrPlanMessage, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import useCardStrings from '~/components/Chat/Cards/useCardStrings';
import RunFooter, { runActiveIndex, runStatusSteps } from './RunFooter';
import {
  consumePlanArrivedLive,
  drAutoStartAtom,
  drProgressByConvoId,
  planArrivedLive,
} from '~/store/deepResearch';
import { useSubmitMessage } from '~/hooks/Messages';
import { useChatContext } from '~/Providers';
import { Square } from '~/components/icons';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';

/** The stop square inside the header slot — same 24px box as the plan's ✕. */
const STOP_GLYPH = 'size-3 fill-current';

/**
 * True while the user has actually TYPED something in the main textarea. A self-start goes
 * out through the composer path, which clears the form after every accepted send
 * (useSubmitMessage resets it) — so a draft in progress vetoes it: the plan then waits for
 * a click and the draft survives. Focus alone is NOT a signal: the composer keeps focus
 * after sending a message (the shipped countdown once died on exactly that, on its first
 * tick).
 */
function isComposerBusy(): boolean {
  const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
  return textarea != null && textarea.value.trim().length > 0;
}

/**
 * The ChatGPT-style Deep Research PLAN card (task #21): the research plan (title + steps)
 * with Начать / Редактировать and a header ✕ «Отменить исследование». Начать and ✕ send a
 * fixed marker message, threaded under THIS plan by name (the runner routes it into DR via
 * the drKind-verified plan parent); Редактировать focuses the composer and shows a hint —
 * «опишите, что изменить, план пересоберётся» — so the user knows the plan is edited by
 * typing in chat (the runner re-plans that turn). The buttons stay, so a mis-tap is never a
 * dead end, and Начать still runs the plan as-is (review r2).
 *
 * The card waits for a click for as long as it takes (r30, owner 02.09): the 30-second
 * autostart is gone — no reference product has one, and ours fired under a user still
 * reading the plan and inside a backgrounded tab. «Запускать исследование сразу»
 * (Settings → Chat) is the opt-in that replaced it: a plan whose FINAL this tab just
 * processed starts itself and draws no buttons at all. The decision is made once, the
 * moment the plan becomes the actionable tip, and it spends the live mark whatever it
 * decides — so a plan mounted from history (no mark) waits for a click like before, a later
 * flip of the setting cannot launch a plan that has been waiting, and a draft in the
 * composer or a refusal by a busy chat both fall back to the ordinary buttons, silently.
 *
 * `awaitingAction` is true only while the plan is the unanswered tip of the DISPLAYED
 * branch — once a turn follows it the card renders statically (no buttons).
 */
export default function PlanCard({
  message,
  awaitingAction,
  cancelled = false,
  isRunning = false,
  conversationId,
  outcome,
}: {
  message: TMessage;
  awaitingAction: boolean;
  /** The plan has a cancel child: the outcome lands as the header badge
   *  (r25 — the «Исследование отменено» chip row is hidden). */
  cancelled?: boolean;
  /** THIS plan's start command exists and the chat is generating: the card
   *  becomes the running card (r26, owner: one card for the plan and its
   *  execution, not two). The snapshot is subscribed HERE, in the leaf —
   *  subscribing in ContentRender would re-render the whole transcript on
   *  every progress event (RunningSlot's own warning). */
  isRunning?: boolean;
  conversationId?: string | null;
  /** How the run under this plan ended: a report (every step reads done) or a
   *  stop (the steps are NOT claimed done — the card says «Остановлено»).
   *  Absent = it never ran, and the plan keeps its resting look. */
  outcome?: 'report' | 'stopped';
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { submitMessage } = useSubmitMessage();
  const { stopGenerating } = useChatContext();
  /* An idle card subscribes to the empty key — a shared, always-null atom —
   * so a conversation full of past plans costs one no-op subscription each. */
  const snapshot = useRecoilValue(drProgressByConvoId(isRunning ? (conversationId ?? '') : ''));
  /* Complementary with RunningSlot BY CONSTRUCTION: it stands down exactly when
   * the snapshot carries steps, so this card must claim exactly the same
   * snapshots. Before the graph starts (prepare/plan) the snapshot has none —
   * neither card draws and the waiting label owns the screen, which is the r26
   * arrangement. Reading the same field on both sides is what keeps a gap from
   * opening between them (r28 review found one: a continuation drew nothing at
   * all for minutes). */
  const running = (snapshot?.steps?.length ?? 0) > 0 ? snapshot : null;
  const startRightAway = useAtomValue(drAutoStartAtom);
  const { title, steps } = useMemo(() => parseDrPlanMessage(message.text ?? ''), [message.text]);
  const [acted, setActed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [liveNote, setLiveNote] = useState('');
  /* The self-start stood down — a draft in the composer, or the chat refused the
   * command — and from here on this is an ordinary waiting card with buttons. */
  const [selfStartDeclined, setSelfStartDeclined] = useState(false);
  const cardStrings = useCardStrings();

  /**
   * `acted` hides the buttons, so it may only follow a submit the chat actually TOOK:
   * `submitMessage` returns false while another generation still streams, and flipping
   * `acted` regardless left the card with no buttons and nothing running — a dead end
   * only F5 could clear (the shipped bug). A refusal now leaves the card untouched, so
   * the same tap works once the chat frees up.
   *
   * These buttons are the reason the refusal needs saying out loud: unlike the composer
   * (Enter is gated on `isSubmitting`, Send turns into Stop) nothing stops the user from
   * pressing them mid-generation, and a button that visibly does nothing is the complaint
   * this fixes. Announcing at the call site is upstream's own pattern — `ask` reports the
   * refusal by return value and leaves the UX to whoever asked (AudioRecorder does the same).
   * The self-start is the exception (`quiet`): a toast about a busy chat, in reply to
   * nothing the user did, would be noise — the buttons appearing say it all.
   *
   * The ref — not a side effect inside a state updater — blocks the second tap of a
   * double-tap, which lands before the re-render that removes the buttons: an updater must
   * be pure, since React may re-invoke it when rebasing a concurrent render.
   */
  const actedRef = useRef(false);
  const act = useCallback(
    (marker: string, { quiet = false }: { quiet?: boolean } = {}): boolean => {
      if (actedRef.current) {
        return false;
      }
      if (submitMessage({ text: marker, parentMessageId: message.messageId }) === false) {
        if (!quiet) {
          showToast({ message: localize('com_ui_send_while_submitting'), status: 'warning' });
        }
        return false;
      }
      actedRef.current = true;
      setActed(true);
      return true;
    },
    [submitMessage, showToast, localize, message.messageId],
  );

  const start = useCallback(() => act(DR_START_MARKER), [act]);
  const cancel = useCallback(() => act(DR_CANCEL_MARKER), [act]);

  const edit = useCallback(() => {
    // Clicking Редактировать means "I want to change the plan", so the hint tells the user
    // to describe the change in chat (the plan then rebuilds) — NOT "press Start". The
    // buttons stay; Начать still works if they'd rather run as-is.
    setEditing(true);
    setLiveNote(localize('com_ui_deep_research_edit_hint'));
    const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
    textarea?.focus();
  }, [localize]);

  /* The self-start (r30). Read in render only to keep the buttons off the first frame of
   * a plan about to start itself; the mark is SPENT in the effect below — the one place a
   * start is fired from — so a double-invoked dev render cannot spend it. */
  const selfStartArmed =
    startRightAway &&
    awaitingAction &&
    !acted &&
    !selfStartDeclined &&
    planArrivedLive(message.messageId);

  useEffect(() => {
    if (!awaitingAction || acted) {
      return;
    }
    /* One live arrival, one decision — whatever it turns out to be. A follow-up plan card
     * can mount non-actionable (the latestMessage atom that gates `awaitingAction` settles
     * a render later), which is why this waits on the flip rather than on mount. */
    if (!consumePlanArrivedLive(message.messageId)) {
      return;
    }
    if (!startRightAway) {
      return;
    }
    if (isComposerBusy() || !act(DR_START_MARKER, { quiet: true })) {
      setSelfStartDeclined(true);
    }
  }, [awaitingAction, acted, startRightAway, message.messageId, act]);

  const showControls = awaitingAction && !acted && !selfStartArmed;

  /* One card for the whole research (r26). While the run is live the plan's
   * own steps carry its status — done / being worked on / ahead — and when it
   * ends with a report they all read done. A plan that never ran keeps the
   * resting look (no status at all), which is what the approval state is. */
  const planItems = useMemo(() => {
    if (outcome === 'report') {
      return steps.map((step, i) => ({ id: String(i), title: step, status: 'done' as const }));
    }
    if (running == null) {
      return steps.map((step, i) => ({ id: String(i), title: step }));
    }
    return runStatusSteps(steps, running, runActiveIndex(running, steps.length));
  }, [steps, running, outcome]);

  /* The run's own footer: what it is doing now, and how far along it is.
   * Offline replaces the action line and freezes everything — a parked run
   * must not look busy (review r2's invariant, kept from the split card). */
  const runningFootnote = running == null ? null : <RunFooter data={running} />;

  const controlsFootnote = showControls ? (
    <>
      {editing && (
        <div className="mt-1 text-right text-xs text-text-tertiary">
          {localize('com_ui_deep_research_edit_hint')}
        </div>
      )}
      <span role="status" className="sr-only">
        {liveNote}
      </span>
    </>
  ) : undefined;

  let headerAction: ReactNode;
  if (running != null) {
    headerAction = (
      <ApprovalCardHeaderAction
        label={localize('com_ui_deep_research_stop')}
        onClick={stopGenerating}
        testId="dr-stop"
      >
        <Square className={STOP_GLYPH} aria-hidden="true" />
      </ApprovalCardHeaderAction>
    );
  } else if (showControls) {
    /* Named for what it does. «Отмена» alone was one of two ✕ with that caption on the
     * same card, with opposite consequences (design review 02.09, К1). */
    headerAction = (
      <ApprovalCardHeaderAction
        label={localize('com_ui_deep_research_cancel')}
        onClick={cancel}
        testId="dr-cancel"
      />
    );
  } else if (cancelled) {
    headerAction = (
      <span data-testid="plan-cancelled" className="text-xs font-medium text-text-tertiary">
        {localize('com_ui_cards_cancelled')}
      </span>
    );
  } else if (outcome === 'stopped') {
    /* A stopped run must not read as «never started» — and its steps are NOT
     * claimed done, because nobody knows how far it got (r26 review). */
    headerAction = (
      <span data-testid="plan-stopped" className="text-xs font-medium text-text-tertiary">
        {localize('com_ui_deep_research_stopped')}
      </span>
    );
  }

  return (
    <div className="my-2 w-full">
      <ApprovalCard
        variant="plan"
        strings={cardStrings}
        title={localize('com_ui_deep_research')}
        planTitle={title || undefined}
        todoTitle={localize('com_ui_deep_research_steps')}
        plan={planItems}
        approveLabel={localize('com_ui_deep_research_start')}
        secondaryLabel={localize('com_ui_edit')}
        showActions={showControls}
        headerAction={headerAction}
        onApprove={start}
        onSecondary={edit}
        secondaryPressed={editing}
        footnote={runningFootnote ?? controlsFootnote}
      />
    </div>
  );
}
