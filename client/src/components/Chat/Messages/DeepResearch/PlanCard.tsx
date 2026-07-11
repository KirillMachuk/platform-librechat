import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Telescope } from 'lucide-react';
import { Button } from '@librechat/client';
import { parseDrPlanMessage, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useSubmitMessage } from '~/hooks/Messages';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';

/**
 * The autostart anchor, fixed ONCE per `createdAt` value. Three cases, all safe:
 * - live message (no `createdAt` yet — it is set on persistence) → mount time;
 * - refetched message with a past `createdAt` → that timestamp, so an F5 mid-countdown
 *   resumes at the correct remaining time and an expired window stays manual;
 * - client clock BEHIND the server (`createdAt` in the local future) → clamped to mount
 *   time. Recomputing the clamp per tick froze the counter at the full window forever
 *   (same value → React bails out — the mechanism of the shipped frozen-timer bug), so
 *   the anchor is resolved once and only moves when `createdAt` itself changes.
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
 * parent); Редактировать only cancels the autostart and focuses the composer — the
 * buttons stay, so a mis-tap is never a dead end (review r2; before, one tap on
 * Редактировать hid all three buttons permanently).
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
}: {
  message: TMessage;
  awaitingAction: boolean;
  autoStartSec?: number;
}) {
  const localize = useLocalize();
  const { submitMessage } = useSubmitMessage();
  const { data: startupConfig } = useGetStartupConfig();
  const effectiveAutoStartSec = autoStartSec ?? startupConfig?.deepResearch?.planAutoStartSec ?? 0;
  const { title, steps } = useMemo(() => parseDrPlanMessage(message.text ?? ''), [message.text]);
  const [acted, setActed] = useState(false);
  const [autoStartCancelled, setAutoStartCancelled] = useState(false);
  const [liveNote, setLiveNote] = useState('');

  const anchorMs = useCountdownAnchor(message.createdAt);
  const [remaining, setRemaining] = useState<number | null>(() =>
    awaitingAction ? remainingFrom(anchorMs, effectiveAutoStartSec) : null,
  );

  const start = useCallback(() => {
    setActed((was) => {
      if (!was) {
        submitMessage({ text: DR_START_MARKER });
      }
      return true;
    });
  }, [submitMessage]);

  const cancel = useCallback(() => {
    setActed((was) => {
      if (!was) {
        submitMessage({ text: DR_CANCEL_MARKER });
      }
      return true;
    });
  }, [submitMessage]);

  const cancelAutoStart = useCallback(
    (announcement: string) => {
      setAutoStartCancelled(true);
      setRemaining(null);
      setLiveNote(announcement);
    },
    [setAutoStartCancelled],
  );

  const edit = useCallback(() => {
    cancelAutoStart(localize('com_ui_deep_research_autostart_cancelled'));
    const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
    textarea?.focus();
  }, [cancelAutoStart, localize]);

  const countdownActive = awaitingAction && !acted && !autoStartCancelled && remaining != null;

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
        start();
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

  return (
    <div className="my-2 w-full overflow-hidden rounded-2xl border border-border-light bg-surface-primary-alt p-4">
      <div className="mb-3 flex items-center gap-2">
        <Telescope className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <h3 className="min-w-0 text-base font-semibold text-text-primary [overflow-wrap:anywhere]">
          {title || localize('com_ui_deep_research')}
        </h3>
      </div>
      {steps.length > 0 && (
        <ol className="mb-4 space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-text-secondary">
              <span
                className="mt-1 inline-block size-3.5 shrink-0 rounded-full border border-border-medium"
                aria-hidden="true"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {showControls && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={edit} aria-label={localize('com_ui_edit')}>
              {localize('com_ui_edit')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={cancel}
              aria-label={localize('com_ui_cancel')}
            >
              {localize('com_ui_cancel')}
            </Button>
            <Button
              variant="submit"
              size="sm"
              onClick={start}
              aria-label={localize('com_ui_deep_research_start')}
            >
              {localize('com_ui_deep_research_start')}
              {remaining != null && (
                <span className="ml-1.5 tabular-nums opacity-80">({remaining})</span>
              )}
            </Button>
          </div>
          {autoStartCancelled && (
            <div className="mt-2 text-right text-xs text-text-tertiary">
              {localize('com_ui_deep_research_autostart_cancelled')}
            </div>
          )}
          <span role="status" className="sr-only">
            {liveNote}
          </span>
        </>
      )}
    </div>
  );
}
