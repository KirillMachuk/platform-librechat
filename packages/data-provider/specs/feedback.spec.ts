import { feedbackSchema, toMinimalFeedback, getTagByKey } from '../src/feedback';

/**
 * The chat UI writes ratings through `toMinimalFeedback`, and the server validates the
 * request body with `feedbackSchema`. These have to agree: a payload the UI can produce
 * must never be rejected, and junk must never reach the Mixed subdocument it is stored on.
 */
describe('feedback wire shape', () => {
  it('accepts what the chat UI sends for a rating with a reason', () => {
    const payload = toMinimalFeedback({
      rating: 'thumbsDown',
      tag: getTagByKey('not_helpful'),
      text: 'ответ ни о чём',
    });

    expect(feedbackSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a rating with a reason and no comment', () => {
    const payload = toMinimalFeedback({
      rating: 'thumbsUp',
      tag: getTagByKey('accurate_reliable'),
    });

    expect(feedbackSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    ['an unknown rating', { rating: 'bogus', tag: 'not_helpful' }],
    ['an unknown reason tag', { rating: 'thumbsUp', tag: 'tag_from_nowhere' }],
    ['a non-string tag', { rating: 'thumbsUp', tag: ['a;b'] }],
    ['a non-string comment', { rating: 'thumbsUp', tag: 'other', text: { nested: true } }],
    ['a comment past the cap', { rating: 'thumbsUp', tag: 'other', text: 'x'.repeat(1025) }],
  ])('rejects %s', (_case, payload) => {
    expect(feedbackSchema.safeParse(payload).success).toBe(false);
  });
});
