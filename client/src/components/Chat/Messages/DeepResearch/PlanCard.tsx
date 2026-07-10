import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Telescope } from 'lucide-react';
import { Button } from '@librechat/client';
import { parseDrPlanMessage, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useSubmitMessage } from '~/hooks/Messages';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';

/** Default autostart window (seconds) for the plan card; 0 → manual start only. */
export const DR_PLAN_AUTOSTART_SEC = 60;

/**
 * Seconds left in the autostart window, from the message's wall-clock age. A LIVE plan
 * message has no `createdAt` yet (it is set on persistence), so the card's mount time is
 * the fallback anchor — recomputing from `Date.now()` on every tick made the value freeze
 * at the full window (same number → React bails out → the timer never rescheduled; live
 * bug: a counter stuck at 60). Clamped to the window against server/client clock skew.
 */
function remainingFrom(
  createdAt: string | undefined,
  autoStartSec: number,
  fallbackMs: number,
): number | null {
  if (!autoStartSec) {
    return null;
  }
  const parsedMs = createdAt ? new Date(createdAt).getTime() : NaN;
  const baseMs = Number.isFinite(parsedMs) ? parsedMs : fallbackMs;
  const left = Math.min(autoStartSec, autoStartSec - Math.floor((Date.now() - baseMs) / 1000));
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
 * send a fixed marker message (the runner routes it into DR via the plan parent, badge-
 * independent); Редактировать focuses the composer so the user refines the plan by typing.
 *
 * `awaitingAction` is true only while the plan is the unanswered tip of the branch — once a
 * turn follows it (start/edit/cancel) the card renders statically (no timer, no buttons).
 * The countdown derives from the message's wall-clock age on EVERY tick (immune to
 * background-tab timer throttling), so a plan reopened after its window never surprise-
 * starts, and typing in the composer cancels the autostart (manual mode).
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
  const effectiveAutoStartSec =
    autoStartSec ?? startupConfig?.deepResearch?.planAutoStartSec ?? DR_PLAN_AUTOSTART_SEC;
  const { title, steps } = useMemo(() => parseDrPlanMessage(message.text ?? ''), [message.text]);
  const [acted, setActed] = useState(false);

  const mountedAtRef = useRef<number>(Date.now());
  const [remaining, setRemaining] = useState<number | null>(() =>
    awaitingAction
      ? remainingFrom(message.createdAt, effectiveAutoStartSec, mountedAtRef.current)
      : null,
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

  const edit = useCallback(() => {
    setActed((was) => {
      if (!was) {
        const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
        textarea?.focus();
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!awaitingAction || acted || remaining == null) {
      return;
    }
    if (remaining <= 0) {
      start();
      return;
    }
    const timer = setTimeout(() => {
      if (isComposerBusy()) {
        setRemaining(null);
        return;
      }
      setRemaining(
        remainingFrom(message.createdAt, effectiveAutoStartSec, mountedAtRef.current) ?? 0,
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [awaitingAction, acted, remaining, start, message.createdAt, effectiveAutoStartSec]);

  const showControls = awaitingAction && !acted;

  return (
    <div className="my-2 w-full rounded-2xl border border-border-light bg-surface-primary-alt p-4">
      <div className="mb-3 flex items-center gap-2">
        <Telescope className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <h3 className="text-base font-semibold text-text-primary">
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
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {showControls && (
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
              <span className="ml-1.5 tabular-nums opacity-80">{remaining}</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
