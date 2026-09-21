import { useCallback, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { Constants, LocalStorageKeys } from 'librechat-data-provider';
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
  const { conversation, isSubmitting, getMessages, setMessages, latestMessageId, files } =
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
      /* A clarification is words only (owner decision 3). Attached files would
       * otherwise stay in the composer unseen and ride along with the NEXT
       * ordinary message — refuse aloud and keep everything where it is. */
      if (files != null && files.size > 0) {
        showToast({ message: localize('com_ui_dr_steer_no_files'), status: 'warning' });
        return false;
      }
      inFlight.current = true;
      setSteerPending(true);
      try {
        const { message, parentMessageId } = await steerStream({ conversationId, text: clean });
        const list = (getMessages() ?? []).filter((m) => m.messageId !== message.messageId);
        /* In the tab that started the run the running answer is the latest
         * message and hangs under the head the server named; it moves under
         * the clarification, exactly as the server will save it. After a reload
         * there is no placeholder in the feed (research streams no content
         * before the report), so nothing matches and nothing moves — the
         * server's final brings the tree.
         *
         * ORDER MATTERS: buildTree attaches a message only to a parent that
         * comes EARLIER in the array. The clarification therefore goes right
         * BEFORE the answer it now parents — appended after it, the answer
         * found no parent, became a root of its own, and the feed showed that
         * lone root instead of the conversation (seen live on the first steered
         * run, 21.09.2026: question, plan card and bubble all gone until the
         * final rebuilt the array). */
        const answerAt = list.findIndex(
          (m) =>
            !m.isCreatedByUser &&
            m.messageId === latestMessageId &&
            m.parentMessageId === parentMessageId,
        );
        if (answerAt < 0) {
          setMessages([...list, message as TMessage]);
        } else {
          setMessages([
            ...list.slice(0, answerAt),
            message as TMessage,
            { ...list[answerAt], parentMessageId: message.messageId },
            ...list.slice(answerAt + 1),
          ]);
        }
        /* Text typed while a response is generated is kept as the PENDING
         * draft and restored into the field when the turn ends — right for an
         * unsent thought, wrong for a clarification the run has taken: it came
         * back into the composer after the report (same live run). */
        try {
          localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.PENDING_CONVO}`);
        } catch {
          /* Storage unavailable: nothing was saved there either. */
        }
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
    [
      canSteer,
      conversationId,
      getMessages,
      setMessages,
      latestMessageId,
      files,
      showToast,
      localize,
    ],
  );

  return { canSteer, steerClosed, steerPending, steer };
}
