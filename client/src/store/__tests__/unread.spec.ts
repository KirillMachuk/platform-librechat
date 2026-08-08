import type { UnreadMarks } from '../unread';
import { isConversationUnread } from '../unread';

/**
 * The awkward cases, not the happy one. Every assertion here stands for a way a
 * dot could appear when nothing happened, or fail to appear when something did.
 */
describe('isConversationUnread', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000;
  const marks = (over: Partial<UnreadMarks> = {}): UnreadMarks => ({
    since: now - 30 * day,
    opened: {},
    ...over,
  });

  it('never marks the conversation you are looking at', () => {
    expect(isConversationUnread(marks(), 'a', now, true)).toBe(false);
  });

  it('marks a conversation that changed after you last opened it', () => {
    const state = marks({ opened: { a: now - day } });
    expect(isConversationUnread(state, 'a', now, false)).toBe(true);
  });

  it('leaves alone a conversation you opened after its last change', () => {
    const state = marks({ opened: { a: now } });
    expect(isConversationUnread(state, 'a', now - day, false)).toBe(false);
  });

  /* The one that would have made this feature useless on day one: a browser
     that has never seen the app before would light up every chat in history. */
  it('treats everything older than the day it started counting as read', () => {
    const state = marks({ since: now - day });
    expect(isConversationUnread(state, 'never-opened', now - 30 * day, false)).toBe(false);
    expect(isConversationUnread(state, 'never-opened', now, false)).toBe(true);
  });

  it('says nothing when there is no timestamp to compare', () => {
    expect(isConversationUnread(marks(), 'a', null, false)).toBe(false);
    expect(isConversationUnread(marks(), 'a', 'вчера', false)).toBe(false);
  });

  it('says nothing about a conversation with no id yet', () => {
    expect(isConversationUnread(marks(), null, now, false)).toBe(false);
    expect(isConversationUnread(marks(), '', now, false)).toBe(false);
  });

  it('reads an ISO string the same as a number', () => {
    const state = marks({ opened: { a: now - day } });
    expect(isConversationUnread(state, 'a', new Date(now).toISOString(), false)).toBe(true);
  });
});
