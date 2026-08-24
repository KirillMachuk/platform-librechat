import fs from 'fs';
import path from 'path';

/**
 * Round 23, item 2 root guard. Any scrollbar-width / scrollbar-color /
 * ::-webkit-scrollbar rule OUTSIDE a `@media (hover: hover)` block switches
 * the browser to a CSS-drawn, in-content-layer scrollbar on touch devices,
 * where it loses to positioned children (row buttons chopped the sidebar bar
 * on the owner's iPhone — twice: the r22 gating missed an unguarded duplicate
 * block upstream had left further down the file). Hiding rules are exempt:
 * `none`-style values keep the native overlay indicator suppressed
 * intentionally and never draw anything.
 */
const CSS_FILES = ['../style.css', '../mobile.css'];

const HIDER_SELECTOR = /\.(no-scrollbar|hide-scrollbar)/;

function stripComments(source: string): string {
  /* Blank out comment bodies while preserving line numbers, so rule text in
   * comments (including this guard's own documentation) never trips the scan. */
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

function unguardedScrollbarRules(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const offenders: string[] = [];
  const lines = source.split('\n');
  let depth = 0;
  const mediaStack: Array<{ depth: number; query: string }> = [];
  let currentSelector = '';
  lines.forEach((line, idx) => {
    const tokens = line.match(/@media[^{]*|\{|\}|[^{}]+(?=\{)/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith('@media')) {
        mediaStack.push({ depth, query: token });
      } else if (token === '{') {
        depth += 1;
      } else if (token === '}') {
        depth -= 1;
        if (mediaStack.length && mediaStack[mediaStack.length - 1].depth === depth) {
          mediaStack.pop();
        }
      } else if (token.trim()) {
        currentSelector = token.trim();
      }
    }
    if (/scrollbar-width|scrollbar-color|::-webkit-scrollbar/.test(line)) {
      const guarded = mediaStack.some((m) => /hover:\s*hover/.test(m.query));
      const isHider = HIDER_SELECTOR.test(currentSelector) || HIDER_SELECTOR.test(line);
      if (!guarded && !isHider) {
        offenders.push(`${idx + 1}: ${line.trim()}`);
      }
    }
  });
  return offenders;
}

describe('scrollbar styling stays behind @media (hover: hover)', () => {
  for (const rel of CSS_FILES) {
    it(`${path.basename(rel)} has no unguarded scrollbar rules`, () => {
      const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(unguardedScrollbarRules(source)).toEqual([]);
    });
  }
});
