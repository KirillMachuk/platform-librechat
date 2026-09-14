const fs = require('fs');
const path = require('path');

/**
 * A structural guard for the one invariant a behaviour test cannot see coming: the
 * controller never hands `addTitle` a way to throw a FINISHED title away
 * (`discardSignal`). `addTitle` persists a finished title even when `signal` was aborted,
 * which title.test.js pins; the rest of the title lifecycle — early persistence, the
 * retry for untitled chats, Stop, the retry wait — is exercised against the real
 * controller in request.titleLifecycle.spec.js.
 *
 * Comments are stripped first: an earlier version matched text, so a comment could fail
 * it and a call with an argument could pass it.
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
