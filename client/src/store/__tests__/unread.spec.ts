import { isConversationUnread } from '../unread';

/**
 * The awkward cases, not the happy one. Every assertion here stands for a way a
 * dot could appear when nothing happened, or fail to appear when something did.
 *
 * The comparison moved to the server (owner 14.08-6): the conversation carries
 * `lastReadAt`, so every device of the account agrees. The pure function now
 * takes the two timestamps straight off the conversation row.
 */
describe('isConversationUnread', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000;
  const iso = (t: number) => new Date(t).toISOString();

  it('never marks the conversation you are looking at', () => {
    expect(isConversationUnread(iso(now), iso(now - day), true)).toBe(false);
  });

  it('marks a conversation that changed after you last opened it', () => {
    expect(isConversationUnread(iso(now), iso(now - day), false)).toBe(true);
  });

  it('leaves alone a conversation you opened after its last change', () => {
    expect(isConversationUnread(iso(now - day), iso(now), false)).toBe(false);
  });

  /* The one that would make the feature useless on day one: existing rows have
     no stamp at all, and every chat in history would light up on every device. */
  it('treats a conversation that was never stamped (legacy row) as read', () => {
    expect(isConversationUnread(iso(now), null, false)).toBe(false);
    expect(isConversationUnread(iso(now), undefined, false)).toBe(false);
  });

  it('says nothing when there is no change timestamp to compare', () => {
    expect(isConversationUnread(null, iso(now), false)).toBe(false);
    expect(isConversationUnread(undefined, undefined, false)).toBe(false);
  });

  it('ignores timestamps that do not parse', () => {
    expect(isConversationUnread('not-a-date', iso(now), false)).toBe(false);
    expect(isConversationUnread(iso(now), 'not-a-date', false)).toBe(false);
  });

  it('accepts Date and epoch inputs interchangeably', () => {
    expect(isConversationUnread(new Date(now), now - day, false)).toBe(true);
    expect(isConversationUnread(now - day, new Date(now), false)).toBe(false);
  });
});
