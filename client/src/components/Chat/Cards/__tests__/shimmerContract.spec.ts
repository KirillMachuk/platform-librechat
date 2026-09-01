import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * The shimmer is CSS, and CSS is where it broke — twice, silently, with the
 * unit tests green (r25 package Б review):
 *
 *  1. a component rule of higher specificity repainted the running step's
 *     label opaque, so the gradient was drawn UNDER the glyphs and the
 *     shimmer never appeared anywhere;
 *  2. `.thinking-shimmer-active` is a one-LINE label utility — its
 *     `white-space: nowrap` stopped a wrapping label from wrapping (a long
 *     research step ran past the card edge on a phone) and its
 *     `display: inline-block` killed a `line-clamp-2` by source order.
 *
 * jsdom applies neither file (CSS modules arrive as identity-obj-proxy), so a
 * render test cannot see any of this. These guards read the stylesheets and
 * pin the contract that makes the shimmer visible at all.
 */

/** __dirname = client/src/components/Chat/Cards/__tests__ → client/src */
const CLIENT_SRC = join(__dirname, '../../../..');
const STYLE = readFileSync(join(CLIENT_SRC, 'style.css'), 'utf8');
const MODULE = readFileSync(join(__dirname, '../ApprovalCard.module.css'), 'utf8');

/** The body of the first rule whose selector list matches `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at === -1) {
    return '';
  }
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('shimmer contract (r25 package Б review)', () => {
  it('the paint-only shimmer exists and carries the gradient, clip and transparent color', () => {
    const body = ruleBody(STYLE, '.thinking-shimmer-paint {');
    expect(body).toMatch(/background-clip:\s*text/);
    expect(body).toMatch(/color:\s*transparent/);
    expect(body).toMatch(/animation:\s*thinking-shimmer-sweep/);
  });

  it('the paint-only shimmer owns NO layout — it must not touch display or wrapping', () => {
    const body = ruleBody(STYLE, '.thinking-shimmer-paint {');
    expect(body).not.toMatch(/\bdisplay\s*:/);
    expect(body).not.toMatch(/white-space\s*:/);
  });

  it('the label utility still owns its own layout (its consumers rely on it)', () => {
    const body = ruleBody(STYLE, '.thinking-shimmer-active {');
    expect(body).toMatch(/white-space:\s*nowrap/);
  });

  it('reduced motion turns the paint into a plain readable color', () => {
    const reduced = STYLE.slice(STYLE.indexOf('.thinking-shimmer-paint {'));
    const guarded = reduced.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(guarded).toBeGreaterThan(-1);
    const body = ruleBody(reduced.slice(guarded), '.thinking-shimmer-paint {');
    expect(body).toMatch(/animation:\s*none/);
    expect(body).toMatch(/color:\s*var\(--text-/);
  });

  it('the running step rule does NOT set a color — that would hide the gradient', () => {
    /* The exact defect: specificity (0,3,0) beat the shimmer's (0,1,0) and the
     * glyphs came back opaque. Weight is fine; color is not. */
    const body = ruleBody(MODULE, ".todoItem[data-status='active'] .todoLabel {");
    expect(body).toMatch(/font-weight/);
    expect(body).not.toMatch(/(^|[^-])color\s*:/);
  });

  it('reduced motion gives the running step its contrast back', () => {
    const reduced = MODULE.slice(MODULE.indexOf('@media (prefers-reduced-motion: reduce)'));
    const body = ruleBody(reduced, ".todoItem[data-status='active'] .todoLabel {");
    expect(body).toMatch(/color:\s*var\(--text-primary\)/);
  });
});

describe('transparent text must survive being selected (owner r28)', () => {
  /**
   * Selecting a shimmering label left a blank petrol bar: the glyphs are drawn
   * by a gradient clipped to the text, the text itself is transparent, and the
   * selection background paints over the gradient with nothing left to draw the
   * letters. Measured in the running app: without the paired rule the selection
   * pseudo-element resolves to `rgba(0, 0, 0, 0)` for both `color` and
   * `-webkit-text-fill-color`; with it, to the solid text colour.
   *
   * This is a CLASS of defect, not one instance — eleven places use it, five of
   * them straight from upstream — so the guard is on the rule, not on a
   * component: whatever zeroes the text fill must name a selection colour.
   */
  const zeroingClasses = () => {
    const found = new Set<string>();
    const re = /\.([\w-]+)\s*\{([^}]*)\}/g;
    for (const [, name, body] of STYLE.matchAll(re)) {
      if (
        /(^|[^-])color:\s*transparent/.test(body) ||
        /-webkit-text-fill-color:\s*transparent/.test(body)
      ) {
        found.add(name);
      }
    }
    return [...found];
  };

  it('finds the classes that zero the text fill (the guard must have something to guard)', () => {
    expect(zeroingClasses().length).toBeGreaterThan(0);
  });

  it('every one of them names a selection colour', () => {
    const selectors = STYLE.match(/[^{}]*::selection[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
    for (const name of zeroingClasses()) {
      expect(`${name} -> ${selectors}`).toContain(`.${name}::selection`);
    }
  });

  it('the selection rule restores BOTH properties', () => {
    /* The two class families zero the fill differently — `color` in ours, the
     * upstream `-webkit-text-fill-color` in `.shimmer` — so one property alone
     * would leave the other family invisible. */
    const rule = STYLE.slice(STYLE.indexOf('.thinking-shimmer-active::selection'));
    const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'));
    expect(body).toMatch(/(^|[^-])color:\s*var\(--text-/);
    expect(body).toMatch(/-webkit-text-fill-color:\s*var\(--text-/);
  });
});
