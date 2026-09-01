import type { TMessage } from './types';
import { buildTree } from './messages';

const message = (messageId: string, parentMessageId: string, extra: Partial<TMessage> = {}) =>
  ({ messageId, parentMessageId, text: '', ...extra }) as TMessage;

describe('buildTree', () => {
  it('nests a linear thread and counts one child per parent', () => {
    const tree = buildTree({
      messages: [message('a', '0'), message('a_', 'a'), message('b', 'a_')],
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].messageId).toBe('a');
    expect(tree[0]['children']).toHaveLength(1);
    expect(tree[0]['children'][0]['children']).toHaveLength(1);
  });

  it('keeps real siblings apart', () => {
    const tree = buildTree({
      messages: [message('a', '0'), message('b', 'a'), message('c', 'a')],
    });

    expect(tree[0]['children'].map((child: TMessage) => child.messageId)).toEqual(['b', 'c']);
    expect(tree[0]['children'].map((child) => child['siblingIndex'])).toEqual([0, 1]);
  });

  it('FAILS ON PRE-FIX CODE: the same message twice is one node, not a branch (r29)', () => {
    /* How the owner's Deep Research chat grew a «2 / 2» switcher it never earned: a
     * resumed run handed the final handler a transcript that already held the turn's
     * user message, and it was appended a second time. Both copies hung under the plan,
     * and only the second one carried the report — the first half of the switcher was an
     * empty dead end. */
    const start = message('start', 'plan', { isCreatedByUser: true });
    const tree = buildTree({
      messages: [
        message('plan', '0'),
        start,
        start,
        message('report', 'start', { isCreatedByUser: false }),
      ],
    });

    expect(tree[0]['children']).toHaveLength(1);
    expect(tree[0]['children'][0]['children']).toHaveLength(1);
  });

  it('a repeated message takes the LATER copy — a resumed turn finishes with fresh text', () => {
    /* The duplicate is not always noise: the database copy of a response is the partial
     * saved at disconnect, and the final event carries the finished one. */
    const tree = buildTree({
      messages: [
        message('a', '0'),
        message('a_', 'a', { text: 'partial' }),
        message('b', 'a_'),
        message('a_', 'a', { text: 'finished' }),
      ],
    });

    const response = tree[0]['children'][0];
    expect(response.text).toBe('finished');
    expect(response['children']).toHaveLength(1);
    expect(response['children'][0].messageId).toBe('b');
  });
});
