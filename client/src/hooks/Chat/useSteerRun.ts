import { useCallback, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import { drProgressByConvoId } from '~/store/deepResearch';
import { steerStream } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';
import { useChatContext } from '~/Providers';

/** The phases in which the run's mailbox is open: the graph is streaming and
 *  no report is being written yet. `prepare`/`plan` come before the graph
 *  (the server would answer «not ready»), `report` after the last round. */
const OPEN_PHASES = new Set(['scope', 'research']);

/** The server's refusal text is the next step in the user's words; anything
 *  else (network, 500) gets the generic line. */
function refusalText(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
  return typeof data?.error === 'string' && data.error ? data.error : undefined;
}

/**
 * Mid-run steering (DR_MIDRUN_STEERING_Plan.md): while a Deep Research run is
 * gathering, the ordinary composer sends a clarification to the run instead
 * of a new turn. The clarification appears as a plain user bubble, the
 * running answer moves under it (one branch, one run), and a toast confirms
 * that the next round will read it — the owner chose no mark on the card.
 */
export default function useSteerRun() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation, isSubmitting, getMessages, setMessages, latestMessageId } =
    useChatContext();
  const conversationId = conversation?.conversationId ?? '';
  const progress = useRecoilValue(drProgressByConvoId(conversationId));
  const [steerPending, setSteerPending] = useState(false);
  /* The state above is for the button; the ref is the guard: Enter and a click
   * in the same tick both read the state before React re-rendered it. */
  const inFlight = useRef(false);

  const live =
    isSubmitting && progress != null && conversationId !== '' && conversationId !== 'new';
  /** The report is being written: the composer says so and sends nothing. */
  const steerClosed = live && progress.phase === 'report';
  const canSteer = live && OPEN_PHASES.has(progress.phase);

  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      const clean = text.trim();
      if (!clean || !canSteer || inFlight.current) {
        return false;
      }
      inFlight.current = true;
      setSteerPending(true);
      try {
        const { message, parentMessageId } = await steerStream({ conversationId, text: clean });
        const list = getMessages() ?? [];
        /* In the tab that started the run the running answer is the latest
         * message and hangs under the head the server named; it moves under
         * the clarification, exactly as the server will save it. After a reload
         * there is no placeholder in the feed (research streams no content
         * before the report), so nothing matches and nothing moves — the
         * server's final brings the tree. */
        const rehung = list.map((m) =>
          !m.isCreatedByUser &&
          m.messageId === latestMessageId &&
          m.parentMessageId === parentMessageId
            ? { ...m, parentMessageId: message.messageId }
            : m,
        );
        setMessages([
          ...rehung.filter((m) => m.messageId !== message.messageId),
          message as TMessage,
        ]);
        showToast({ message: localize('com_ui_dr_steer_accepted'), status: 'success' });
        return true;
      } catch (error) {
        showToast({
          message: refusalText(error) ?? localize('com_ui_dr_steer_failed'),
          status: 'warning',
        });
        return false;
      } finally {
        inFlight.current = false;
        setSteerPending(false);
      }
    },
    [canSteer, conversationId, getMessages, setMessages, latestMessageId, showToast, localize],
  );

  return { canSteer, steerClosed, steerPending, steer };
}
