import { join, relative } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';

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
  /* Found, not listed: a hard list of three read three of the four sheets under
   * client/src, and a new `.module.css` would have joined the blind zone in
   * silence (design review 02.09, В8). */
  const stylesheets = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          stylesheets(child, out);
        }
      } else if (entry.name.endsWith('.css')) {
        out.push(child);
      }
    }
    return out;
  };
  const ROOTS = [CLIENT_SRC, join(CLIENT_SRC, '../../packages/client/src')].filter(existsSync);
  const SHEETS: [string, string][] = ROOTS.flatMap((root) =>
    stylesheets(root).map((file): [string, string] => [
      relative(CLIENT_SRC, file),
      readFileSync(file, 'utf8'),
    ]),
  );

  it('reads every stylesheet the client ships, the phone one included', () => {
    expect(SHEETS.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'style.css',
        'mobile.css',
        'components/Chat/Cards/ApprovalCard.module.css',
        'components/Chat/Cards/ThinkingReasoning.module.css',
      ]),
    );
  });

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
        const subject =
          part
            .trim()
            .split(/[\s>+~]+/)
            .pop() ?? '';
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

/**
 * The shimmer paints text that carries `color: transparent`, so a reference
 * that does not resolve does not degrade — it erases the words. One commit
 * shipped exactly that: a refactor moved the gradient behind custom properties
 * and deleted both the properties and the keyframes, and «Думаю…», the Deep
 * Research action line and the running plan step all rendered blank while every
 * test here stayed green (they only asserted that the declarations were
 * present). These resolve what the declarations point AT.
 */
describe('every shimmer reference resolves inside the stylesheet', () => {
  /* Windows checks out the stylesheet with CRLF, so nothing here may match a
   * bare "\n" — a slice that missed cost one red shard. */
  const SHEET = STYLE.replace(/\r\n/g, '\n');
  const rules = SHEET.slice(
    SHEET.indexOf('.thinking-shimmer-active,'),
    SHEET.indexOf('.shadow-stroke {'),
  );

  it('the block exists and is the one the classes are defined in', () => {
    expect(rules).toContain('.thinking-shimmer-paint');
    expect(rules.length).toBeGreaterThan(200);
  });

  it('every custom property it reads is defined in the same stylesheet', () => {
    const read = new Set(Array.from(rules.matchAll(/var\((--[a-z0-9-]+)/g), (m) => m[1]));
    expect(read.size).toBeGreaterThan(0);
    for (const name of read) {
      expect(SHEET).toMatch(new RegExp(`\\s${name}:`));
    }
  });

  it('every animation it names has its keyframes in the same stylesheet', () => {
    const named = Array.from(rules.matchAll(/animation:\s*([a-z0-9-]+)/g), (m) => m[1]).filter(
      (name) => name !== 'none',
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(SHEET).toContain(`@keyframes ${name}`);
    }
  });

  it('reduced motion gives BOTH classes their colour back', () => {
    const block = rules.slice(rules.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.thinking-shimmer-active');
    expect(block).toContain('.thinking-shimmer-paint');
    expect(block).toMatch(/color:\s*var\(--text-/);
  });
});
