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
 * Raw `box-shadow` in a stylesheet is checked too (it did start happening: a
 * card module carried its own three-layer shadow twice, design review 02.09,
 * item 11). Every layer of a declaration must be one of: a canon token
 * (`var(--c-shadow-*)`), a hairline ring (`0 0 0 <n>px …`, a border drawn as a
 * shadow), an `inset` ring, or `none`. The definitions themselves live in
 * `style.css` under `--c-shadow-*` and are the one place a raw value belongs.
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
/** A raw `box-shadow: …;` declaration in a stylesheet, vendor-prefixed or not
 *  (the token definitions are `--c-shadow-*: …`, a different property name). */
const RAW_BOX_SHADOW = /(?<![\w-])(?:-webkit-)?box-shadow\s*:\s*([^;{}]+);/g;
/** One layer of a raw declaration that the canon allows: a token; an outside
 *  ring — a border drawn as a shadow, no blur, spread at most 8px (a 9999px
 *  "ring" is a scrim); an inset ring or fill — no blur, any spread (the
 *  autofill trick paints a field with a 50vh inset, which is a fill, while a
 *  blurred inset is depth); an empty layer (`0 0 transparent` — Tailwind's ring
 *  machinery and a keyframe's rest state); or Tailwind's own `--tw-*`
 *  composition, which is not a depth step. */
const OUTSIDE_RING = '0 0 0 (?:[0-7](?:\\.\\d+)?|8)px\\b.*';
const INSET_RING =
  '(?:inset 0 0 0 [\\d.]+(?:px|vh|vw|rem|em)\\b.*|0 0 0 [\\d.]+(?:px|vh|vw|rem|em)\\b.* inset)';
const ALLOWED_LAYER = new RegExp(
  `^(none|var\\(--c-shadow-[\\w-]+\\)|var\\(--tw-[\\w-]+(?:,\\s*0 0 transparent)?\\)|${OUTSIDE_RING}|${INSET_RING}|0 0(?: 0){0,2} transparent)$`,
);
/** Splits a box-shadow value on top-level commas (rgba(…) carries commas of its own). */
const layers = (value) => {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((layer) => layer.replace(/\s+/g, ' ').trim()).filter(Boolean);
};

/** Strips comments so a rule quoted in a doc block cannot trip the rule — keeping
 *  every newline, so the line numbers reported below are the file's own. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
    if (!file.endsWith('.css')) continue;
    for (const hit of text.matchAll(RAW_BOX_SHADOW)) {
      const bad = layers(hit[1]).filter((layer) => !ALLOWED_LAYER.test(layer));
      if (bad.length === 0) continue;
      const line = text.slice(0, hit.index).split('\n').length;
      problems.push(`${relative(ROOT, file)}:${line}  box-shadow: ${bad.join(', ')}`);
    }
  }
}

if (problems.length) {
  console.error(
    `\nDESIGN_SYSTEM §2: the system has three shadows — \`shadow-sm\` (surfaces),\n` +
      `\`shadow-lg\` (menus, dialogs, sheets, popovers) and the contact shadow of the\n` +
      `interactive cards (\`var(--c-shadow-card)\`); \`shadow-none\` is the legal\n` +
      `fourth state, a hairline ring (\`0 0 0 0.5px …\`) is a border. These\n` +
      `${problems.length} are none of them:\n`,
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

console.log('Shadow canon: three shadows, no drift.');
