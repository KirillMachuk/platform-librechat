const fs = require('fs');
const path = require('path');

/**
 * A structural guard, on purpose — and one that reads CODE, not comments.
 *
 * The title of a stopped or failed chat was lost three times over (#494, #497, and a
 * Stop followed quickly by the next message, found in review on 14.09), each time with
 * a green suite, because the defect lived at a call site in the controller while the
 * tests pinned a helper. Running the real controller would mean standing up the agent
 * client, the job manager, the model and the database. The invariants are about
 * wiring, so the guard checks wiring:
 *
 * 1. the controller never hands `addTitle` a way to throw a finished title away
 *    (`discardSignal`) — `addTitle` persists a finished title even when `signal` was
 *    aborted, which is pinned by its own test in services/Endpoints/agents/title.test.js;
 * 2. every path that ends a run cancels a title still being generated — so an ended
 *    turn stops paying the title model — and the failure path does so before anything
 *    that can fail. (Ordering against `resolveConvoReady()` is deliberately NOT pinned:
 *    `addTitle` saves a finished title whether or not `signal` was aborted, so that
 *    order has no observable effect, and a guard on it would guard nothing.)
 *
 * Comments are stripped first. The previous version of this guard matched the text
 * `titleDiscardController.abort()` and so could be failed by a comment and passed by a
 * call with an argument; review mutated the controller three ways and it stayed green.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'request.js'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Text between the brace that opens at or after `from` and its matching close. */
function blockAt(text, from) {
  const open = text.indexOf('{', from);
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') {
      depth++;
    } else if (text[i] === '}' && --depth === 0) {
      return text.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

function addTitleCalls(text) {
  const calls = [];
  const pattern = /\baddTitle\(\s*req\s*,/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    calls.push(blockAt(text, match.index));
  }
  return calls;
}

describe('a finished title is never thrown away by the agents controller', () => {
  it('finds the calls it is guarding', () => {
    /* immediate, fallback, final-timing and the legacy controller */
    expect(addTitleCalls(code).length).toBeGreaterThanOrEqual(3);
  });

  it('no addTitle call carries a discard signal, under any name', () => {
    for (const call of addTitleCalls(code)) {
      expect(call).not.toMatch(/discardSignal/);
    }
    expect(code).not.toMatch(/titleDiscard/);
  });

  it('the immediate title is cancelled by the title controller, not the job controller', () => {
    /* `completeJob` aborts the job's own controller on SUCCESS, which would cancel a
     * title that is merely slower than a short answer. */
    const immediate = addTitleCalls(code).find((call) => /immediate:\s*true/.test(call));
    expect(immediate).toBeDefined();
    expect(immediate).toMatch(/signal:\s*titleAbortController\.signal/);
  });
});

describe('every path that ends a run cancels a title still in generation', () => {
  const cancels = (block) => {
    const abortAt = block.indexOf('titleAbortController.abort()');
    expect(abortAt).toBeGreaterThan(-1);
    return abortAt;
  };

  it('the replaced branch of the success path (where a Stop that deleted the job lands)', () => {
    const at = code.indexOf('if (jobWasReplaced)');
    expect(at).toBeGreaterThan(-1);
    cancels(blockAt(code, at));
  });

  it('the stopped branch of the success path (a Stop that left the job in place)', () => {
    const at = code.indexOf('if (wasAbortedBeforeComplete) {', code.indexOf('if (jobWasReplaced)'));
    expect(at).toBeGreaterThan(-1);
    cancels(blockAt(code, at));
  });

  it('the failure path, before anything it awaits', () => {
    const replacedAt = code.indexOf('const jobWasReplaced');
    const catchAt = code.indexOf('} catch (error) {', replacedAt);
    expect(catchAt).toBeGreaterThan(-1);
    const block = blockAt(code, catchAt + 1);
    const abortAt = cancels(block);
    const firstAwait = block.indexOf('await ');
    if (firstAwait > -1) {
      expect(abortAt).toBeLessThan(firstAwait);
    }
  });
});
