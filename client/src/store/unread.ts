import { useCallback, useEffect, useRef } from 'react';
import { useReadConvoMutation } from '~/data-provider';

/**
 * Which conversations changed while you were not looking.
 *
 * The dot beside a chat means "there is something here you have not seen".
 * The comparison lives on the SERVER now (owner 14.08-6): the conversation
 * carries `lastReadAt` — when this account last had it open — so every
 * device agrees. The first cut kept the marks in localStorage, and reading
 * a chat on the laptop left the dot burning on the phone.
 *
 * A conversation with no `lastReadAt` (legacy rows, never stamped) reads as
 * read — the same bootstrap the local version had: without it, the day the
 * feature ships every chat anyone has ever had would light up.
 */

const asTime = (value: string | number | Date | null | undefined): number => {
  if (value == null) {
    return 0;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Pure, so the awkward cases can be tested without a browser: a chat you are
 * looking at is never unread, a chat never stamped (legacy) is never unread,
 * and a stamped chat is unread only if it moved after the stamp.
 */
export const isConversationUnread = (
  updatedAt: string | number | Date | null | undefined,
  lastReadAt: string | number | Date | null | undefined,
  isActive: boolean,
): boolean => {
  if (isActive) {
    return false;
  }
  const changedAt = asTime(updatedAt);
  const readAt = asTime(lastReadAt);
  if (changedAt === 0 || readAt === 0) {
    return false;
  }
  return changedAt > readAt;
};

/**
 * Marks the conversation you are in as read, at the two moments that are
 * actually moments: when you arrive, and when its answer stops arriving.
 *
 * There is no third one. A conversation changes continuously while an answer
 * streams into it, and stamping on every change would POST to the server a
 * hundred times a minute to record something the person is watching happen.
 */
export const useMarkActiveConversationRead = (
  conversationId: string | null | undefined,
  isSubmitting: boolean,
) => {
  const { mutate } = useReadConvoMutation();
  const wasSubmitting = useRef(isSubmitting);

  const markRead = useCallback(
    (id: string | null | undefined) => {
      if (id == null || id === '') {
        return;
      }
      mutate({ conversationId: id });
    },
    [mutate],
  );

  useEffect(() => {
    markRead(conversationId);
  }, [conversationId, markRead]);

  useEffect(() => {
    if (wasSubmitting.current && !isSubmitting) {
      markRead(conversationId);
    }
    wasSubmitting.current = isSubmitting;
  }, [isSubmitting, conversationId, markRead]);
};
