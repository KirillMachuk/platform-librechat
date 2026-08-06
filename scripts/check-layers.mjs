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
 *    Scoped to one `className` at a time, never to the whole file: a `fixed` on
 *    one element and a `z-[60]` on another are not the same element, and
 *    pairing them would make this shout at code that is fine.
 *
 *    The whole attribute value, though — not one quoted run inside it. The
 *    first version matched a single-line string and missed the two patterns
 *    that matter most, both measured rather than imagined:
 *      - a multi-line template literal (`DragDropOverlay`, the file that used
 *        to carry z-9999): reintroducing the number left this green;
 *      - classes split across `cn()` arguments, where `fixed` sits in one and
 *        the number in another.
 * ------------------------------------------------------------------ */
/**
 * A number rather than a name: `z-[999]` and `z-50` alike. Tailwind's own scale
 * counts — it is off the canon just as much as an invented value, and leaving
 * it out let a whole dialog primitive (`AlertDialog`) and the SharePoint picker
 * sit on 50 while this reported the canon held.
 *
 * Worse than merely off-scale: `tailwind-merge` does not recognise the named
 * classes as z-index utilities, so a caller's `z-50` does NOT replace the
 * component's `z-dialog` — both survive into the DOM and whichever rule the
 * build emitted last wins. Measured: today `.z-dialog` happens to come later,
 * so the SharePoint dialog renders correctly by luck.
 */
const RAW_Z = /\bz-(?:\[\d+\]|\d+)\b/;
const SOURCES = [...walk('client/src'), ...walk('packages/client/src')];

/** Every `className=` value in the file, braces balanced so `cn(...)` comes whole. */
function classNameValues(text) {
  const out = [];
  const attribute = /className\s*=\s*/g;
  let match;
  while ((match = attribute.exec(text)) !== null) {
    let i = match.index + match[0].length;
    const opener = text[i];
    if (opener === '"' || opener === "'") {
      const end = text.indexOf(opener, i + 1);
      if (end === -1) continue;
      out.push(text.slice(i + 1, end));
      attribute.lastIndex = end;
      continue;
    }
    if (opener !== '{') continue;
    let depth = 0;
    const start = i;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(start + 1, i));
    attribute.lastIndex = i;
  }
  return out;
}

for (const rel of SOURCES) {
  const source = read(rel);
  if (!source) continue;
  for (const classes of classNameValues(stripComments(source))) {
    if (!RAW_Z.test(classes)) continue;
    if (!/\bfixed\b/.test(classes)) continue;
    fail(
      `${relative('.', rel).split(sep).join('/')}`,
      `a page-level overlay carries ${classes.match(RAW_Z)[0]}`,
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
