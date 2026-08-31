import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { parseDrPlanMessage, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { ApprovalCardStrings } from '~/components/Chat/Cards/ApprovalCard';
import type { TDeepResearchProgress } from '~/store/deepResearch';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import { drProgressByConvoId } from '~/store/deepResearch';
import { useGetStartupConfig } from '~/data-provider';
import { Square, WifiOff } from '~/components/icons';
import { useSubmitMessage } from '~/hooks/Messages';
import { useChatContext } from '~/Providers';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';

/** Owner's decision (cards track, 25.08): the visible countdown is ALWAYS the
 *  aicss 30 s pie; the config keeps exactly one meaning — 0 switches
 *  autostart off. Any other configured value still means "autostart on". */
const PLAN_AUTO_START_SECS = 30;
/** The stop square inside the header slot — same 24px box as the plan's ✕. */
const STOP_GLYPH = 'size-3 fill-current';

/**
 * The autostart anchor: when the plan was made, so the window means the same thing live and
 * after an F5. Cases, all safe:
 * - a plan card carries `createdAt` from its first render — live finals ship the persisted
 *   message — so the window counts from the plan, not from whenever this card mounted (a
 *   backgrounded tab must not be handed a fresh full window);
 * - refetched mid-countdown → the same timestamp → the count resumes where it was, and an
 *   expired window stays manual;
 * - client clock BEHIND the server (`createdAt` in the local future) → clamped to mount
 *   time. A clock AHEAD by more than the window reads it as already expired: no timer,
 *   manual buttons only — the fail-safe direction, and the same thing a refetched card has
 *   always done.
 * Fixed ONCE per `createdAt` value: recomputing the clamp per tick froze the counter at the
 * full window forever (same value → React bails out — the mechanism of the shipped
 * frozen-timer bug), so the anchor only moves when `createdAt` itself changes.
 */
function useCountdownAnchor(createdAt: string | undefined): number {
  const anchorRef = useRef<{ key: string | undefined; ms: number } | null>(null);
  if (anchorRef.current == null || anchorRef.current.key !== createdAt) {
    const parsed = createdAt ? new Date(createdAt).getTime() : NaN;
    const now = Date.now();
    anchorRef.current = {
      key: createdAt,
      ms: Number.isFinite(parsed) ? Math.min(parsed, now) : now,
    };
  }
  return anchorRef.current.ms;
}

/** Seconds left in the autostart window from the fixed anchor; null once expired (or when
 *  autostart is disabled). A reopened card whose window has passed never surprise-starts. */
function remainingFrom(anchorMs: number, autoStartSec: number): number | null {
  if (!autoStartSec) {
    return null;
  }
  const left = autoStartSec - Math.floor((Date.now() - anchorMs) / 1000);
  return left > 0 ? left : null;
}

/** True while the user has actually TYPED something in the main textarea — autostart must
 *  never fire under someone composing a plan edit. Focus alone is NOT a signal: the
 *  composer keeps focus after sending a message, which killed the countdown on its very
 *  first tick (live bug: the counter vanished and autostart never happened). */
function isComposerBusy(): boolean {
  const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
  return textarea != null && textarea.value.trim().length > 0;
}

/**
 * The ChatGPT-style Deep Research PLAN card (task #21): shows the research plan (title +
 * steps) with Начать / Редактировать / Отменить + a countdown autostart. Начать/Отменить
 * send a fixed marker message (the runner routes it into DR via the drKind-verified plan
 * parent); Редактировать cancels the autostart, focuses the composer, and shows a hint —
 * «опишите, что изменить, план пересоберётся» — so the user knows the plan is edited by
 * typing in chat (the runner re-plans that turn). The buttons stay, so a mis-tap is never
 * a dead end, and Начать still runs the plan as-is (review r2; before, one tap on
 * Редактировать hid all three buttons, and its caption misleadingly said "press Start").
 *
 * `awaitingAction` is true only while the plan is the unanswered tip of the DISPLAYED
 * branch — once a turn follows it the card renders statically (no timer, no buttons).
 * The countdown runs on a single interval whose lifecycle is independent of the rendered
 * value (immune to React state bail-outs AND background-tab throttling — each tick
 * recomputes from the wall-clock anchor). Typing in the composer cancels the autostart
 * (announced via the status line); rollback safety: absent server DR config → autostart
 * DISABLED, manual buttons only.
 */
export default function PlanCard({
  message,
  awaitingAction,
  autoStartSec,
  cancelled = false,
  isRunning = false,
  conversationId,
  finished = false,
}: {
  message: TMessage;
  awaitingAction: boolean;
  autoStartSec?: number;
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
  /** The run under this plan ended with a report: every step reads done. */
  finished?: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { submitMessage } = useSubmitMessage();
  const { stopGenerating } = useChatContext();
  /* An idle card subscribes to the empty key — a shared, always-null atom —
   * so a conversation full of past plans costs one no-op subscription each. */
  const running = useRecoilValue(drProgressByConvoId(isRunning ? (conversationId ?? '') : ''));
  const { data: startupConfig } = useGetStartupConfig();
  const configuredAutoStart = autoStartSec ?? startupConfig?.deepResearch?.planAutoStartSec ?? 0;
  const effectiveAutoStartSec = configuredAutoStart === 0 ? 0 : PLAN_AUTO_START_SECS;
  const { title, steps } = useMemo(() => parseDrPlanMessage(message.text ?? ''), [message.text]);
  const [acted, setActed] = useState(false);
  const [autoStartCancelled, setAutoStartCancelled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [liveNote, setLiveNote] = useState('');

  const anchorMs = useCountdownAnchor(message.createdAt);
  const [remaining, setRemaining] = useState<number | null>(() =>
    awaitingAction ? remainingFrom(anchorMs, effectiveAutoStartSec) : null,
  );

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
   *
   * The ref — not a side effect inside a state updater — blocks the second tap of a
   * double-tap, which lands before the re-render that removes the buttons: an updater must
   * be pure, since React may re-invoke it when rebasing a concurrent render. `act` is
   * synchronous end to end, so a tap can never interleave with a countdown tick inside it.
   */
  const actedRef = useRef(false);
  const act = useCallback(
    (marker: string): boolean => {
      if (actedRef.current) {
        return false;
      }
      if (submitMessage({ text: marker }) === false) {
        showToast({ message: localize('com_ui_send_while_submitting'), status: 'warning' });
        return false;
      }
      actedRef.current = true;
      setActed(true);
      return true;
    },
    [submitMessage, showToast, localize],
  );

  const start = useCallback(() => act(DR_START_MARKER), [act]);
  const cancel = useCallback(() => act(DR_CANCEL_MARKER), [act]);

  const cancelAutoStart = useCallback(
    (announcement: string) => {
      setAutoStartCancelled(true);
      setRemaining(null);
      setLiveNote(announcement);
    },
    [setAutoStartCancelled],
  );

  const edit = useCallback(() => {
    // Distinct from a typing-triggered auto-cancel: clicking Редактировать means "I want to
    // change the plan", so the hint tells the user to describe the change in chat (the plan
    // then rebuilds) — NOT "press Start". The buttons stay; Начать still works if they'd
    // rather run as-is. (task #21 — the autostart-cancelled caption misled here.)
    setEditing(true);
    cancelAutoStart(localize('com_ui_deep_research_edit_hint'));
    const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
    textarea?.focus();
  }, [cancelAutoStart, localize]);

  const countdownActive = awaitingAction && !acted && !autoStartCancelled && remaining != null;

  // Seed `remaining` the moment the card becomes actionable. It is initialised ONCE by
  // useState, but a follow-up plan card can mount with awaitingAction=false — the
  // latestMessage atom that gates it settles a render later, and the runner's final event
  // carries no `depth`, so the depth-based `isLast` stays false until the id-based
  // `isLatestMessage` flips it (ContentRender). That late flip would leave `remaining` stuck
  // at null, and the countdown — gated on `remaining != null` — would never arm: buttons
  // show but the timer never does (the live follow-up-card bug). Seeding here closes the
  // gap; an already-expired window stays null, so a reopened card shows buttons with no
  // timer and never surprise-starts (`remainingFrom` returns null past the window).
  useEffect(() => {
    if (!awaitingAction || acted || autoStartCancelled) {
      return;
    }
    setRemaining((prev) => (prev == null ? remainingFrom(anchorMs, effectiveAutoStartSec) : prev));
  }, [awaitingAction, acted, autoStartCancelled, anchorMs, effectiveAutoStartSec]);

  useEffect(() => {
    if (!countdownActive) {
      return;
    }
    setLiveNote(localize('com_ui_deep_research_autostart_in', { 0: String(remaining ?? '') }));
    const timer = setInterval(() => {
      if (isComposerBusy()) {
        cancelAutoStart(localize('com_ui_deep_research_autostart_cancelled'));
        return;
      }
      const left = remainingFrom(anchorMs, effectiveAutoStartSec);
      if (left == null) {
        // A refused autostart must not retry. Past the window `remaining` stops advancing,
        // so this branch fires every tick: without cancelling, a chat busy with another
        // generation would collect one refused start — and one toast — per second. Parking
        // the card on its buttons is what the cancelled caption already tells the user, and
        // it is deliberate that one refusal disarms autostart for good: the refusal that
        // matters (a chat pinned by a stale `isSubmitting`) does not heal on its own.
        // `start()` is also false for "already acted", which cannot reach here (a click
        // flips `acted`, tearing this interval down first) and would be silent anyway —
        // the caption unmounts with the controls.
        if (!start()) {
          cancelAutoStart(localize('com_ui_deep_research_autostart_cancelled'));
        }
        return;
      }
      if (left === 30 || left === 10) {
        setLiveNote(localize('com_ui_deep_research_autostart_in', { 0: String(left) }));
      }
      setRemaining(left);
    }, 1000);
    return () => clearInterval(timer);
    // `remaining` is deliberately NOT a dependency: the interval must survive value
    // bail-outs (a recreate-per-tick design is exactly what froze the shipped counter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownActive, anchorMs, effectiveAutoStartSec, start, cancelAutoStart, localize]);

  const showControls = awaitingAction && !acted;

  const cardStrings: ApprovalCardStrings = useMemo(
    () => ({
      otherPlaceholder: localize('com_ui_cards_other_placeholder'),
      moreLabel: (n) => localize('com_ui_cards_more', { 0: String(n) }),
      lessLabel: localize('com_ui_cards_less'),
      autoApproveBefore: localize('com_ui_cards_autostart_before'),
      autoApproveAfter: localize('com_ui_cards_autostart_after'),
      autoApproveCancelTip: localize('com_ui_cards_cancel_tip'),
      prevQuestion: localize('com_ui_cards_prev_question'),
      nextQuestion: localize('com_ui_cards_next_question'),
      cancelAutoApprove: localize('com_ui_cards_cancel_autostart'),
      questionOf: (c, t) => localize('com_ui_cards_question_of', { 0: String(c), 1: String(t) }),
      customAnswerFor: (prompt) => localize('com_ui_cards_custom_answer_for', { 0: prompt }),
    }),
    [localize],
  );

  /* One card for the whole research (r26). While the run is live the plan's
   * own steps carry its status — done / being worked on / ahead — and when it
   * ends with a report they all read done. A plan that never ran keeps the
   * resting look (no status at all), which is what the approval state is. */
  const planItems = useMemo(() => {
    if (finished) {
      return steps.map((step, i) => ({ id: String(i), title: step, status: 'done' as const }));
    }
    if (running == null) {
      return steps.map((step, i) => ({ id: String(i), title: step }));
    }
    const activeStep = Math.min(
      Math.floor((running.progress ?? 0) * Math.max(steps.length, 1)),
      Math.max(steps.length - 1, 0),
    );
    return steps.map((step, i) => {
      let status: 'pending' | 'active' | 'done' = 'pending';
      if (i < activeStep) {
        status = 'done';
      } else if (i === activeStep && running.stalled !== true) {
        status = 'active';
      }
      return { id: String(i), title: step, status };
    });
  }, [steps, running, finished]);

  /* The run's own footer: what it is doing now, and how far along it is.
   * Offline replaces the action line and freezes everything — a parked run
   * must not look busy (review r2's invariant, kept from the split card). */
  const runningFootnote =
    running == null ? null : (
      <div className="mt-1">
        {running.stalled === true ? (
          <div
            role="status"
            className="mb-2 flex min-h-5 items-center gap-1.5 text-xs text-text-tertiary"
          >
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{localize('com_ui_deep_research_offline')}</span>
          </div>
        ) : (
          running.action && (
            <div className="thinking-shimmer-paint mb-2 line-clamp-2 min-h-5 text-xs [overflow-wrap:anywhere]">
              {running.action}
            </div>
          )
        )}
        <div
          role="progressbar"
          aria-label={localize('com_ui_deep_research')}
          aria-valuenow={Math.max(0, Math.min(100, Math.round((running.progress ?? 0) * 100)))}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
        >
          <div
            className="h-full rounded-full bg-text-accent transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(0, Math.min(100, Math.round((running.progress ?? 0) * 100)))}%`,
            }}
          />
        </div>
      </div>
    );

  const controlsFootnote = showControls ? (
    <>
      {(editing || autoStartCancelled) && (
        <div className="mt-1 text-right text-xs text-text-tertiary">
          {localize(
            editing ? 'com_ui_deep_research_edit_hint' : 'com_ui_deep_research_autostart_cancelled',
          )}
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
    headerAction = <ApprovalCardHeaderAction label={localize('com_ui_cancel')} onClick={cancel} />;
  } else if (cancelled) {
    headerAction = (
      <span data-testid="plan-cancelled" className="text-xs font-medium text-text-tertiary">
        {localize('com_ui_cards_cancelled')}
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
        autoApprove={
          countdownActive && remaining != null
            ? { secsLeft: remaining, total: PLAN_AUTO_START_SECS }
            : null
        }
        onAutoApproveCancel={() =>
          cancelAutoStart(localize('com_ui_deep_research_autostart_cancelled'))
        }
        onApprove={start}
        onSecondary={edit}
        secondaryPressed={editing}
        footnote={runningFootnote ?? controlsFootnote}
      />
    </div>
  );
}
