/**
 * Guards the shadow canon (DESIGN_SYSTEM §2 and §4): the system has exactly two
 * shadows — `shadow-sm` for surfaces and cards, `shadow-lg` for what floats
 * above the page (menus, dialogs, sheets, popovers). Nothing else exists.
 *
 * Run with `npm run check:shadows`.
 *
 * Why a guard rather than a one-time sweep: the sweep that made this file
 * possible touched 40 files and removed 51 shadows that had drifted in one at a
 * time — `shadow-md` on a badge, `shadow-2xl` on a dialog, a hand-written
 * `shadow-[0_0_15px_rgba(0,0,0,0.3)]` on an avatar. Every one of them arrived in
 * a change that was about something else, and every one of them was invisible in
 * review because a shadow reads as a detail. A rule nobody can see being broken
 * gets broken again; the owner's words for it were that there must be one source
 * of truth, not one shadow here and another there.
 *
 * Deliberately NOT flagged: `shadow-none` (removing a shadow is always allowed)
 * and `shadow-transparent`. Both say "no shadow", which is the third legal state.
 *
 * What this cannot see: a shadow written in CSS as a raw `box-shadow` property.
 * Those live in `style.css` under the `--c-shadow-*` variables, which is exactly
 * where the two canon shadows are defined, so a raw one there is the definition
 * itself. New raw `box-shadow` in a component file would slip past — if that
 * starts happening, extend this.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['client/src', 'packages/client/src'];
const EXTENSIONS = /\.(tsx?|jsx?|css)$/;

/**
 * The rungs of Tailwind's depth scale that the canon does not have, plus any
 * hand-written `shadow-[…]`.
 *
 * Two things are deliberately NOT matched, both learned by getting it wrong:
 *
 * `shadow-<word>` in general — the fork has its own named classes that merely
 * start with the word (`shadow-stroke`, an outline around an icon on a photo;
 * the legacy `shadow-outline`), and Tailwind's generated CSS carries
 * `--tw-shadow-colored`. None is a step on the depth scale. That version named
 * 29 things while the real drift was zero.
 *
 * The bare `shadow` class — matching it means matching the word `shadow`
 * wherever it stands alone, which is `box-shadow`, `transition-shadow`, mermaid
 * theme keys and half of style.css: 59 more false alarms. A bare `shadow` does
 * slip past this guard as a result. That is the trade: a guard that cries wolf
 * is a guard people learn to ignore, and everything the sweep actually found in
 * this repo was a size or an arbitrary value.
 */
const OFFENDING = /\bshadow(?:-(?:md|xl|2xl|inner)\b|-\[[^\]]*\])/g;

/** Strips comments so a rule quoted in a doc block cannot trip the rule. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(child, out);
      continue;
    }
    if (EXTENSIONS.test(entry.name)) out.push(child);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const hit of line.matchAll(OFFENDING)) {
        problems.push(`${relative(ROOT, file)}:${index + 1}  ${hit[0]}`);
      }
    });
  }
}

if (problems.length) {
  console.error(
    `\nDESIGN_SYSTEM §2: the system has two shadows — \`shadow-sm\` (surfaces and\n` +
      `cards) and \`shadow-lg\` (menus, dialogs, sheets, popovers). \`shadow-none\` is\n` +
      `the third legal state. These ${problems.length} are none of them:\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nPick by what the element IS, not by how strong the shadow should look:\n` +
      `  floats over the page → shadow-lg\n` +
      `  sits on the page     → shadow-sm\n` +
      `  a state (hover, pressed, selected) → no shadow at all; §1.4 says state is\n` +
      `  said with fill and colour, never with depth.\n`,
  );
  process.exit(1);
}

console.log('Shadow canon: two shadows, no drift.');
