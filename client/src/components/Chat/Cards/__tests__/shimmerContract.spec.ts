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
   * This guards the CLASS of defect, not one instance — eleven places use it,
   * five of them straight from upstream — so it scans EVERY stylesheet the app
   * ships, expands grouped selectors, and demands that each zeroing class name
   * a selection colour that actually restores the fill (r28 review found all
   * three of those holes in the first version of this guard).
   */
  const SHEETS: [string, string][] = [
    ['style.css', STYLE],
    ['ApprovalCard.module.css', MODULE],
    [
      'ThinkingReasoning.module.css',
      readFileSync(join(__dirname, '../ThinkingReasoning.module.css'), 'utf8'),
    ],
  ];

  /* Comments first: a rule's selector is «everything since the last closing
   * brace», so a comment ABOVE it joins the selector text and a comment that
   * merely mentions a class name would be read as one (found while writing
   * this). */
  const rules = (css: string): [string, string][] =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
      ([, selector, body]) => [selector, body],
    );

  /** Every class in a rule that zeroes the text fill — grouped selectors give
   *  one entry per class, not just the last one. */
  const zeroing = (css: string): string[] => {
    const out = new Set<string>();
    for (const [selector, body] of rules(css)) {
      const zeroed =
        /(^|[^-])color:\s*transparent/.test(body) ||
        /-webkit-text-fill-color:\s*transparent/.test(body);
      if (!zeroed || selector.includes('::selection')) {
        continue;
      }
      /* Only the SUBJECT of each compound: in `.dark .shimmer` the element that
       * carries the transparent fill is `.shimmer`, and demanding a selection
       * rule for the theme wrapper would be nonsense. */
      for (const part of selector.split(',')) {
        const subject = part.trim().split(/[\s>+~]+/).pop() ?? '';
        for (const [, name] of subject.matchAll(/\.([\w-]+)/g)) {
          out.add(name);
        }
      }
    }
    return [...out];
  };

  /** Bodies of the selection rules that name `cls`, across every sheet. */
  const selectionBodies = (cls: string): string[] =>
    SHEETS.flatMap(([, css]) =>
      rules(css)
        .filter(([selector]) => new RegExp(`\\.${cls}::selection(\\s|,|$)`).test(selector))
        .map(([, body]) => body),
    );

  it('finds the classes that zero the text fill (the guard must have something to guard)', () => {
    const all = SHEETS.flatMap(([, css]) => zeroing(css));
    expect(all.length).toBeGreaterThan(0);
  });

  it('every one of them has a selection rule that RESTORES the fill', () => {
    const broken: string[] = [];
    for (const [sheet, css] of SHEETS) {
      for (const cls of zeroing(css)) {
        const bodies = selectionBodies(cls);
        const restores = bodies.some(
          (b) => /(^|[^-])color:\s*[^;]+/.test(b) || /-webkit-text-fill-color:\s*[^;]+/.test(b),
        );
        if (!restores) {
          broken.push(`${sheet}: .${cls}`);
        }
      }
    }
    /* A selection rule that only sets a background leaves the glyphs exactly as
     * invisible, so «has a rule» is not the bar — «puts a colour back» is. */
    expect(broken).toEqual([]);
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
