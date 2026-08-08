import { useCallback, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { createStorageAtom } from './jotai-utils';

/**
 * Which conversations changed while you were not looking.
 *
 * The dot beside a chat used to mean "this is the one you have open", which the
 * filled background already says — two marks for one state. It now means "there
 * is something here you have not seen".
 *
 * The product has no such notion, so it is derived: a conversation is unread
 * when it changed after the last time you had it open. That comparison needs
 * two things stored per browser — when you last opened each chat, and when this
 * browser first started keeping track at all.
 *
 * The second one is not bookkeeping for its own sake. Without it, the first
 * time anyone loads the app every chat they have ever had would light up,
 * because we have never seen any of them. Everything older than the moment we
 * started counting is taken as read.
 *
 * Marks live in this browser. The owner's call: people work from one machine
 * almost always, and following them across devices needs the server.
 */

/** The shape is versioned: a stale shape under a live key reads as corruption. */
const STORAGE_KEY = 'unreadMarks.v1';

/** A mark nobody has touched for this long is for a chat that is long gone. */
const KEEP_MARKS_FOR = 90 * 24 * 60 * 60 * 1000;

export interface UnreadMarks {
  /** When this browser started keeping track. Anything older counts as read. */
  since: number;
  /** conversationId → when the user last had it open. */
  opened: Record<string, number>;
}

const emptyMarks: UnreadMarks = { since: 0, opened: {} };

export const unreadMarksAtom = createStorageAtom<UnreadMarks>(STORAGE_KEY, emptyMarks);

const asTime = (value: string | number | Date | null | undefined): number => {
  if (value == null) {
    return 0;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Pure, so the awkward cases can be tested without a browser: a chat you are
 * looking at is never unread, a chat older than the day we started counting is
 * never unread, and a chat you have opened is unread only if it moved since.
 */
export const isConversationUnread = (
  marks: UnreadMarks,
  conversationId: string | null | undefined,
  updatedAt: string | number | Date | null | undefined,
  isActive: boolean,
): boolean => {
  if (isActive || conversationId == null || conversationId === '') {
    return false;
  }
  const changedAt = asTime(updatedAt);
  if (changedAt === 0) {
    return false;
  }
  return changedAt > Math.max(marks.opened[conversationId] ?? 0, marks.since);
};

const prune = (opened: Record<string, number>, now: number): Record<string, number> => {
  const kept: Record<string, number> = {};
  for (const [id, at] of Object.entries(opened)) {
    if (now - at < KEEP_MARKS_FOR) {
      kept[id] = at;
    }
  }
  return kept;
};

export const useUnreadMarks = () => {
  const [marks, setMarks] = useAtom(unreadMarksAtom);

  /**
   * Stamped at two moments, and only those two: when a conversation becomes the
   * one you are in, and when its answer finishes while you are still in it.
   * Between them the conversation keeps changing under you as the answer
   * streams, and none of that is news to the person watching it arrive.
   */
  const markRead = useCallback(
    (conversationId: string | null | undefined) => {
      if (conversationId == null || conversationId === '') {
        return;
      }
      setMarks((previous) => {
        const now = Date.now();
        return {
          since: previous.since === 0 ? now : previous.since,
          opened: { ...prune(previous.opened, now), [conversationId]: now },
        };
      });
    },
    [setMarks],
  );

  /**
   * A browser that has never marked anything has `since: 0`, which would make
   * every existing chat unread. Called once on start, before any list is drawn.
   */
  const startCountingIfNew = useCallback(() => {
    setMarks((previous) => (previous.since === 0 ? { ...previous, since: Date.now() } : previous));
  }, [setMarks]);

  return { marks, markRead, startCountingIfNew };
};

/**
 * Marks the conversation you are in as read, at the two moments that are
 * actually moments: when you arrive, and when its answer stops arriving.
 *
 * There is no third one. A conversation changes continuously while an answer
 * streams into it, and stamping on every change would be a loop that writes to
 * storage a hundred times a minute to record something the person is watching
 * happen.
 */
export const useMarkActiveConversationRead = (
  conversationId: string | null | undefined,
  isSubmitting: boolean,
) => {
  const { markRead, startCountingIfNew } = useUnreadMarks();
  const wasSubmitting = useRef(isSubmitting);

  useEffect(() => {
    startCountingIfNew();
  }, [startCountingIfNew]);

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
