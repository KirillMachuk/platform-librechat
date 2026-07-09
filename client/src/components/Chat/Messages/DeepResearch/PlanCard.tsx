import { useState, useEffect, useMemo, useCallback } from 'react';
import { Telescope } from 'lucide-react';
import { Button } from '@librechat/client';
import { parseDrPlanMessage, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useSubmitMessage } from '~/hooks/Messages';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';

/** Default autostart window (seconds) for the plan card; 0 → manual start only. */
export const DR_PLAN_AUTOSTART_SEC = 60;

/**
 * The ChatGPT-style Deep Research PLAN card (task #21): shows the research plan (title +
 * steps) with Начать / Редактировать / Отменить + a countdown autostart. Начать/Отменить
 * send a fixed marker message (the runner routes it into DR via the plan parent, badge-
 * independent); Редактировать focuses the composer so the user refines the plan by typing.
 *
 * `awaitingAction` is true only while the plan is the unanswered tip of the branch — once a
 * turn follows it (start/edit/cancel) the card renders statically (no timer, no buttons).
 * The countdown is anchored to the message's creation time, so a plan reopened long after it
 * was shown never surprise-starts (the window has already elapsed → manual only).
 */
export default function PlanCard({
  message,
  awaitingAction,
  autoStartSec = DR_PLAN_AUTOSTART_SEC,
}: {
  message: TMessage;
  awaitingAction: boolean;
  autoStartSec?: number;
}) {
  const localize = useLocalize();
  const { submitMessage } = useSubmitMessage();
  const { title, steps } = useMemo(() => parseDrPlanMessage(message.text ?? ''), [message.text]);
  const [acted, setActed] = useState(false);

  const [remaining, setRemaining] = useState<number | null>(() => {
    if (!awaitingAction || !autoStartSec) {
      return null;
    }
    const createdMs = message.createdAt ? new Date(message.createdAt).getTime() : Date.now();
    const left = autoStartSec - Math.floor((Date.now() - createdMs) / 1000);
    return left > 0 ? left : null;
  });

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
    const timer = setTimeout(() => setRemaining((r) => (r == null ? null : r - 1)), 1000);
    return () => clearTimeout(timer);
  }, [awaitingAction, acted, remaining, start]);

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
