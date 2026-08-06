/**
 * Guards the layer canon (DESIGN_SYSTEM §4): one scale, declared once, and no
 * component inventing a number of its own for something that floats over the
 * page.
 *
 * Run with `npm run check:layers`.
 *
 * Why a source guard on top of the e2e sweep: the e2e sweep only sees layers
 * that happen to be on screen during the run, so a new overlay nobody opens in
 * a test slips past it. This one reads the source and cannot be avoided that
 * way. What it cannot see in return is a layer trapped by an ancestor's
 * transform — that needs the live probe (`tools/layers_probe.js`). The two
 * checks cover each other's blind spots; neither replaces the other.
 *
 * A raw number on an element that is NOT page-level is fine and stays fine:
 * ordering siblings inside one component (stacked avatars, a spinner over a
 * card) is local and has nothing to do with the page scale. The rule fires on
 * `position: fixed` — the marker of "this floats over everything".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const fail = (where, what, how) => problems.push(`${where}\n    ${what}\n    → ${how}`);

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch (error) {
    fail(rel, `cannot be read (${error.code})`, 'update this script so the canon stays guarded');
    return null;
  }
}

/** Strips block and line comments so an example in a doc block cannot trip a rule. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function walk(rel, out = []) {
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(child, out);
      continue;
    }
    if (/\.(tsx|ts)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. The scale is declared exactly once, in the token layer.
 * ------------------------------------------------------------------ */
const EXPECTED = ['sticky', 'scrim-drawer', 'drawer', 'dialog', 'popover', 'toast', 'dragdrop'];

const style = read('client/src/style.css');
if (style) {
  const declared = [...style.matchAll(/--c-z-([a-z-]+):\s*(\d+);/g)].map((m) => m[1]);
  const missing = EXPECTED.filter((name) => !declared.includes(name));
  const extra = declared.filter((name) => !EXPECTED.includes(name));
  if (missing.length) {
    fail(
      'client/src/style.css',
      `the scale is missing ${missing.map((n) => `--c-z-${n}`).join(', ')}`,
      'declare it there, or drop the name from EXPECTED in this script and from DESIGN_SYSTEM §4',
    );
  }
  if (extra.length) {
    fail(
      'client/src/style.css',
      `the scale gained ${extra.map((n) => `--c-z-${n}`).join(', ')}`,
      'a new layer is a canon decision — add it to DESIGN_SYSTEM §4 and to EXPECTED here',
    );
  }
}

const tailwind = read('client/tailwind.config.cjs');
if (tailwind) {
  const exposed = [...tailwind.matchAll(/'?([a-z-]+)'?:\s*'var\(--c-z-([a-z-]+)\)'/g)];
  const unexposed = EXPECTED.filter((name) => !exposed.some(([, , token]) => token === name));
  if (unexposed.length) {
    fail(
      'client/tailwind.config.cjs',
      `these layers have no class: ${unexposed.join(', ')}`,
      'expose every scale entry, otherwise components reach for a raw number instead',
    );
  }
}

/* ------------------------------------------------------------------ *
 * 2. Nothing that floats over the page carries a raw number.
 *
 *    Matched on the className string, not on the whole file: a `fixed` in one
 *    element and a `z-[60]` in another are not the same element, and pairing
 *    them would make this shout at code that is fine.
 * ------------------------------------------------------------------ */
const RAW_Z = /\bz-\[\d+\]/;
const SOURCES = [...walk('client/src'), ...walk('packages/client/src')];

for (const rel of SOURCES) {
  const source = read(rel);
  if (!source) continue;
  const text = stripComments(source);
  /* Every quoted or templated run of classes in the file. */
  for (const [, classes] of text.matchAll(/["'`]([^"'`\n]*\bz-\[\d+\][^"'`\n]*)["'`]/g)) {
    if (!RAW_Z.test(classes)) continue;
    if (!/\bfixed\b/.test(classes)) continue;
    const number = classes.match(RAW_Z)[0];
    fail(
      `${relative('.', rel).split(sep).join('/')}`,
      `a page-level overlay carries ${number}`,
      'use a class from the scale (z-dialog, z-popover, z-toast, z-drawer, z-dragdrop)',
    );
  }
}

/* ------------------------------------------------------------------ *
 * 3. The nesting ladder does not come back.
 *
 *    It was upstream's, it predates the fork, and it is the reason a dialog
 *    opened from the settings dialog rendered underneath it. Order between
 *    modals is decided by the order they were opened in, never by arithmetic.
 * ------------------------------------------------------------------ */
const dialog = read('packages/client/src/components/OriginalDialog.tsx');
if (dialog && /zIndex|DialogDepth|\d+\s*\+\s*\(depth/.test(stripComments(dialog))) {
  fail(
    'packages/client/src/components/OriginalDialog.tsx',
    'a computed z-index is back',
    'modals share one layer; which is on top follows from which was opened last',
  );
}

if (problems.length) {
  console.error(`\nLayer canon broken in ${problems.length} place(s):\n`);
  problems.forEach((p) => console.error(`  ${p}\n`));
  process.exit(1);
}

console.log(`Layer canon holds — scale of ${EXPECTED.length}, ${SOURCES.length} sources scanned.`);
