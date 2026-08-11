/**
 * Guards the focus canon (DESIGN_SYSTEM §1.8): ONE focus for the whole system.
 *
 * The global rule in `client/src/style.css` draws a 2px `--border-focus`
 * outline on every `:focus-visible` (offset +2, or −2 via the named
 * `focus-inset` class for full-width rows) — NEUTRAL ink since 10.08
 * evening, when the owner took the brand accent out of focus entirely.
 * Text fields are the single exception: their focus is the border
 * darkening to the same token (`focus:ring-[3px]
 * focus:ring-ring-primary-soft` stays in the recipe with the ring token
 * currently transparent), and error states may ring with `err-soft`.
 * Nothing else exists.
 *
 * Run with `npm run check:focus`.
 *
 * Why a guard: the sweep that made this file possible found THIRTEEN distinct
 * focus treatments alive at once — shadcn's near-black ring over a white gap
 * on every Button, upstream's ChatGPT-green #19C37D on .btn-primary, hard
 * black/white rings on hover toolbars, one-off blue and indigo rings in
 * dialogs, and a grey ring-offset recipe under half the settings fields. Each
 * arrived in a change that was about something else. Every keypress flips the
 * browser into keyboard modality, so the owner SAW this zoo any time Shift was
 * pressed; a rule that visible cannot be left to review alone.
 *
 * What is deliberately allowed:
 *   - `focus:ring-[3px]` / `ring-ring-primary-soft` — the §1.8 field recipe;
 *   - `ring-err-soft` — the §6.2 field error state;
 *   - `focus:outline-none` / `focus-visible:outline-none` — harmless ONLY
 *     because the global rule now outranks them at (0,3,0). It did not at
 *     first: measured on the built bundle, Tailwind emits utilities after the
 *     raw CSS following `@tailwind utilities`, so at equal specificity every
 *     one of these ~180 classes was a live hole in keyboard focus. If the
 *     global block's specificity is ever lowered, they all come back;
 *   - non-focus rings (`ring-1` on a static badge) — not focus treatments.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['client/src', 'packages/client/src'];
const EXTENSIONS = /\.(tsx?|jsx?)$/;
const SKIP = /__tests__|\.(spec|test)\.[tj]sx?$/;

/**
 * A focus-conditional ring that is not the field recipe: any
 * `focus*:ring-…` or ariakit `data-[focus-visible]:ring-…` whose value is a
 * width, a colour, an offset or an opacity — everything the §1.8 outline now
 * owns. The field recipe survives because `ring-[3px]`, `ring-ring-primary-soft`
 * and `ring-err-soft` are excluded by the lookahead.
 */
const OFFENDING =
  /(?:[\w[\]&>~.:-]+:)*(?:focus(?:-visible|-within)?|data-\[focus-visible\]):ring-(?!\[3px\]|ring-primary-soft\b|err-soft\b|offset-ring-offset\b)[\w[\]/.-]+/g;

/** Raw focus colours have no business outside style.css's single rule.
 *  #19C37D in decimal is 25, 195, 125 — the first draft of this regex wrote
 *  the hex byte as decimal 19 and could not catch the exact colour it was
 *  written for; the mutation test caught the guard. */
const RAW_GREEN = /(25,\s*195,\s*125|#19c37d)/gi;

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
    if (EXTENSIONS.test(entry.name) && !SKIP.test(child)) out.push(child);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, index) => {
      for (const hit of line.matchAll(OFFENDING)) {
        problems.push(`${relative(ROOT, file)}:${index + 1}  ${hit[0]}`);
      }
    });
  }
}

const css = stripComments(readFileSync(join(ROOT, 'client/src/style.css'), 'utf8'));
css.split('\n').forEach((line, index) => {
  for (const hit of line.matchAll(RAW_GREEN)) {
    problems.push(`client/src/style.css:${index + 1}  ${hit[0]} (upstream focus green)`);
  }
});

if (problems.length) {
  console.error(
    `\nDESIGN_SYSTEM §1.8: focus is ONE outline — 2px --border-focus, offset +2, drawn\n` +
      `globally in style.css (\`focus-inset\` for full-width rows). Text fields\n` +
      `alone ring instead: \`focus:ring-[3px] focus:ring-ring-primary-soft\` plus\n` +
      `the \`acc\` border. These ${problems.length} invent something else:\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nDelete the ring — the global outline already covers the element. If it is\n` +
      `a full-width row whose outline gets clipped, add the \`focus-inset\` class.\n` +
      `If it is a text field, use the field recipe above, nothing hand-rolled.\n`,
  );
  process.exit(1);
}

console.log('Focus canon: one outline, one field ring, no drift.');
