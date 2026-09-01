import type { ParentMessage } from './messages';
import type { TMessage } from './types';
import { buildTree } from './messages';

const message = (messageId: string, parentMessageId: string, extra: Partial<TMessage> = {}) =>
  ({ messageId, parentMessageId, text: '', ...extra }) as TMessage;

/** The roots of a tree the test knows is there — `buildTree` answers null only for null input. */
function roots(messages: TMessage[]): ParentMessage[] {
  const tree = buildTree({ messages });
  if (tree == null) {
    throw new Error('buildTree returned null for a real array');
  }
  return tree as ParentMessage[];
}

/** One node, or a loud failure — an absent node must not read as an empty one. */
function at(nodes: ParentMessage[], index: number): ParentMessage {
  const node = nodes[index];
  if (node == null) {
    throw new Error(`no node at index ${index}`);
  }
  return node;
}

const kids = (node: ParentMessage): ParentMessage[] => node.children as ParentMessage[];

describe('buildTree', () => {
  it('nests a linear thread and counts one child per parent', () => {
    const tree = roots([message('a', '0'), message('a_', 'a'), message('b', 'a_')]);

    expect(tree).toHaveLength(1);
    expect(at(tree, 0).messageId).toBe('a');
    expect(kids(at(tree, 0))).toHaveLength(1);
    expect(kids(at(kids(at(tree, 0)), 0))).toHaveLength(1);
  });

  it('keeps real siblings apart', () => {
    const tree = roots([message('a', '0'), message('b', 'a'), message('c', 'a')]);

    expect(kids(at(tree, 0)).map((child) => child.messageId)).toEqual(['b', 'c']);
    expect(kids(at(tree, 0)).map((child) => child['siblingIndex'])).toEqual([0, 1]);
  });

  it('FAILS ON PRE-FIX CODE: the same message twice is one node, not a branch (r29)', () => {
    /* How the owner's Deep Research chat grew a «2 / 2» switcher it never earned: a
     * resumed run handed the final handler a transcript that already held the turn's
     * user message, and it was appended a second time. Both copies hung under the plan,
     * and only the second one carried the report — the first half of the switcher was an
     * empty dead end. */
    const start = message('start', 'plan', { isCreatedByUser: true });
    const tree = roots([
      message('plan', '0'),
      start,
      start,
      message('report', 'start', { isCreatedByUser: false }),
    ]);

    expect(kids(at(tree, 0))).toHaveLength(1);
    expect(kids(at(kids(at(tree, 0)), 0))).toHaveLength(1);
  });

  it('a repeated message takes the LATER copy — a resumed turn finishes with fresh text', () => {
    /* The duplicate is not always noise: the database copy of a response is the partial
     * saved at disconnect, and the final event carries the finished one. */
    const tree = roots([
      message('a', '0'),
      message('a_', 'a', { text: 'partial' }),
      message('b', 'a_'),
      message('a_', 'a', { text: 'finished' }),
    ]);

    const response = at(kids(at(tree, 0)), 0);
    expect(response.text).toBe('finished');
    expect(kids(response)).toHaveLength(1);
    expect(at(kids(response), 0).messageId).toBe('b');
  });
});
