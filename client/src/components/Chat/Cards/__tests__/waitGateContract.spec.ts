import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * The waiting label's visibility is CSS, and jsdom cannot see it: `*.css` maps
 * to identity-obj-proxy (client/jest.config.cjs), so every render test here
 * finds the label present whether or not it would ever paint.
 *
 * What the rules have to guarantee (owner r27, §6.12):
 *  1. the waiting label and the reasoning header share ONE declaration list —
 *     they are the same word in the same spot, and a value that lives twice
 *     drifts (they were 16px/400 and 13px/500 before, which is the defect);
 *  2. the label is hidden unless a `.submitting` ancestor is present. That gate
 *     used to sit on the global `.thinking-shimmer`; it had to move here
 *     because it now has to hide the brain icon too, and a finished reply that
 *     ended up with no text must not park a label on screen forever;
 *  3. the gate wins, which in one file is decided by source order.
 *
 * Same precedent as `shimmerContract.spec.ts`: read the stylesheet.
 */

const MODULE = readFileSync(join(__dirname, '../ThinkingReasoning.module.css'), 'utf8');

describe('waiting-label gate contract (owner r27)', () => {
  it('the header and the waiting label are ONE declaration list', () => {
    expect(MODULE).toMatch(/\.trHeader,\s*\n\s*\.trWait\s*\{/);
  });

  it('that shared list carries the geometry both of them must agree on', () => {
    const shared = MODULE.slice(MODULE.indexOf('.trHeader,'));
    const body = shared.slice(shared.indexOf('{') + 1, shared.indexOf('}'));
    /* The size of the message (owner, 05.09): the header and the waiting
     * label share the reply's size and differ from it by colour only. */
    expect(body).toMatch(/font-size:\s*var\(--markdown-font-size, var\(--font-size-base\)\)/);
    /* The message's own line box, by the formula `.markdown` uses — a literal
     * px value matched the default size only and drifted at every other one. */
    expect(body).toMatch(
      /line-height:\s*calc\(\s*26px \* var\(--markdown-font-size, var\(--font-size-base\)\) \/ var\(--font-size-base\)\s*\)/,
    );
    expect(body).toMatch(/font-weight:\s*400/);
    expect(body).toMatch(/gap:\s*8px/);
  });

  /** The STANDALONE `.trWait { … }` rule — not the shared `.trHeader, .trWait`
   *  list, whose selector also starts a line with `.trWait {`. */
  const hiddenRule = /^\.trWait \{\s*\n\s*display:\s*none;\s*\n\}/m;

  it('the label is hidden by default and shown only under .submitting', () => {
    expect(MODULE).toMatch(hiddenRule);
    const gate = MODULE.indexOf(':global(.submitting) .trWait {');
    expect(gate).toBeGreaterThan(-1);
    expect(MODULE.slice(gate, MODULE.indexOf('}', gate))).toMatch(/display:\s*inline-flex/);
  });

  it('the gate comes AFTER the shared list — one file, so source order decides', () => {
    /* `.trWait { display: none }` and the shared `display: inline-flex` are both
     * (0,1,0); the later one wins. If the gate were hoisted above the shared
     * list the label would always show, including on finished replies. */
    const hiddenAt = MODULE.search(hiddenRule);
    expect(hiddenAt).toBeGreaterThan(MODULE.indexOf('.trHeader,'));
    expect(MODULE.indexOf(':global(.submitting) .trWait {')).toBeGreaterThan(hiddenAt);
  });
});

/**
 * The row geometry lives in CSS, and the component test can only pin the
 * arithmetic around it (it fakes `offsetHeight`). Reverting these two lines to
 * the vendored `height: 40px` brings back the empty line under every one-line
 * thought — «текст через строку» — with every JS test still green, so the CSS
 * is pinned here, where the stylesheet itself is read.
 */
describe('thought rows are as tall as their text (р34)', () => {
  const rule = MODULE.slice(MODULE.indexOf('.trSentence {'));
  const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'));

  it('a row grows from one line to two, and is never a fixed box', () => {
    expect(body).toMatch(/min-height:\s*20px/);
    expect(body).toMatch(/max-height:\s*40px/);
    expect(body).not.toMatch(/(^|[^-])height:\s*40px/);
  });

  it('two lines is the cap, by the line box and the clamp together', () => {
    expect(body).toMatch(/line-height:\s*20px/);
    expect(body).toMatch(/-webkit-line-clamp:\s*2/);
  });
});
