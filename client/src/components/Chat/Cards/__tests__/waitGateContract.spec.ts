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
    expect(body).toMatch(/font-size:\s*calc\(var\(--markdown-font-size\) \* 13 \/ 16\)/);
    expect(body).toMatch(/line-height:\s*18px/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).toMatch(/gap:\s*6px/);
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
