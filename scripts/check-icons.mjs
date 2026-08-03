/**
 * Guards the icon canon (DESIGN_SYSTEM §4): one lucide version, one stroke
 * width, no fresh hand-written SVG in components.
 *
 * Run with `npm run check:icons`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function fail(where, what, how) {
  problems.push(`${where}\n    ${what}\n    → ${how}`);
}

/* ------------------------------------------------------------------ *
 * 1. One lucide version everywhere, including the strings that tell the
 *    artifact sandbox which lucide to load.
 * ------------------------------------------------------------------ */
const PINS = [
  ['client/package.json', /"lucide-react":\s*"\^?([\d.]+)"/g],
  ['packages/client/package.json', /"lucide-react":\s*"\^?([\d.]+)"/g],
  ['client/src/utils/artifacts.ts', /'lucide-react':\s*'\^?([\d.]+)'/g],
  ['packages/api/src/prompts/artifacts/index.ts', /lucide-react@([\d.]+)/g],
  ['api/app/clients/prompts/artifacts.js', /lucide-react@([\d.]+)/g],
];

const versions = new Map();
for (const [file, re] of PINS) {
  for (const [, version] of read(file).matchAll(re)) {
    if (!versions.has(version)) {
      versions.set(version, []);
    }
    versions.get(version).push(file);
  }
}
if (versions.size !== 1) {
  const seen = [...versions].map(([v, files]) => `${v} (${[...new Set(files)].join(', ')})`);
  fail(
    'lucide-react',
    `pinned to more than one version: ${seen.join('; ')}`,
    'pick one and change every pin together — the app, the component package and the artifact sandbox all draw the same icons',
  );
}

/* ------------------------------------------------------------------ *
 * 2. Where the icon rule sits in style.css is load-bearing.
 * ------------------------------------------------------------------ */
const css = read('client/src/style.css');
const rule = css.indexOf('.lucide,');
const components = css.indexOf('@tailwind components;');
const utilities = css.indexOf('@tailwind utilities;');

if (rule === -1) {
  fail('client/src/style.css', 'the .lucide stroke rule is gone', 'restore it — it is what gives every icon the canonical width');
} else if (!(components < rule && rule < utilities)) {
  fail(
    'client/src/style.css',
    'the icon rule no longer sits between the components and utilities directives',
    'move it back: below the utilities a deliberate stroke-[1.5] in markup stops working',
  );
} else if (/@layer[^{]*\{[^}]*\.lucide/s.test(css.slice(components, utilities))) {
  fail(
    'client/src/style.css',
    'the icon rule was wrapped in @layer',
    'unwrap it — Tailwind drops rules inside a layer when it cannot find the class in the source, and this one would vanish silently',
  );
}

/* ------------------------------------------------------------------ *
 * 3. Stroke width belongs to the canon, not to call sites. A component
 *    (capitalised tag) carrying strokeWidth is opting out of it; a plain
 *    <svg>/<path> is drawing its own graphic and may keep it.
 * ------------------------------------------------------------------ */
const SRC = ['client/src', 'packages/client/src'];
const SKIP_DIR = new Set(['node_modules', 'dist', '__tests__', 'tests', 'specs']);
const ICON_LIB = join(ROOT, 'packages/client/src/svgs');

function* sources() {
  for (const root of SRC) {
    yield* walk(join(ROOT, root));
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIR.has(name)) {
        yield* walk(path);
      }
    } else if (name.endsWith('.tsx') && !/\.(spec|test)\.tsx$/.test(name)) {
      yield path;
    }
  }
}

/** Opening tags of capitalised JSX elements, with their attributes. */
const COMPONENT_TAG = /<([A-Z][\w.]*)((?:\s+[^<>]*?)?)\/?>/gs;

/* ------------------------------------------------------------------ *
 * 4. Inline SVG in components. The allowlist is a debt register: it may
 *    shrink, never grow. Genuine graphics (progress rings, the context
 *    gauge, the drop overlay) and vendor marks live here on purpose;
 *    the rest are waiting for the screen batch that owns them.
 * ------------------------------------------------------------------ */
const ALLOWED_INLINE_SVG = {
  'client/src/components/Agents/ErrorDisplay.tsx': 1,
  'client/src/components/Chat/Input/Files/DragDropOverlay.tsx': 1,
  'client/src/components/Chat/Input/Files/ProgressCircle.tsx': 1,
  'client/src/components/Chat/Input/StopButton.tsx': 1,
  'client/src/components/Chat/Input/TokenUsage/Gauge.tsx': 1,
  'client/src/components/Chat/Menus/Endpoints/components/brand.tsx': 1,
  'client/src/components/Chat/Menus/Presets/PresetItems.tsx': 1,
  'client/src/components/Chat/Menus/UI/MenuItem.tsx': 1,
  'client/src/components/Chat/Messages/Content/MemoryArtifacts.tsx': 1,
  'client/src/components/Chat/Messages/Content/ProgressCircle.tsx': 1,
  'client/src/components/Chat/Messages/Content/UIResourceCarousel.tsx': 2,
  'client/src/components/Conversations/Convo.tsx': 1,
  'client/src/components/Messages/Content/LangIcon.tsx': 1,
  'client/src/components/OAuth/OAuthError.tsx': 1,
  'client/src/components/SidePanel/Builder/ActionsAuth.tsx': 1,
  'client/src/components/SidePanel/Builder/Images.tsx': 1,
  'packages/client/src/components/Dropdown.tsx': 1,
  'packages/client/src/components/InputWithDropDown.tsx': 1,
  'packages/client/src/components/Toast.tsx': 1,
};

const seen = new Map();

for (const path of sources()) {
  const rel = relative(ROOT, path);
  const text = readFileSync(path, 'utf8');

  if (!path.startsWith(ICON_LIB)) {
    const count = (text.match(/<svg[\s>]/g) ?? []).length;
    if (count) {
      seen.set(rel, count);
    }
  }

  if (!text.includes('lucide-react')) {
    continue;
  }
  for (const [, tag, attrs] of text.matchAll(COMPONENT_TAG)) {
    if (/\bstrokeWidth\s*=/.test(attrs)) {
      fail(rel, `<${tag}> sets its own strokeWidth`, 'drop it — the canon owns stroke width; if this really is an exception, say so in markup with a stroke-[…] class');
    }
    if (/\bclassName\s*=\s*(["'`])[^"'`]*\bstroke-\d/.test(attrs)) {
      fail(rel, `<${tag}> carries a stroke-N class`, 'drop it unless the deviation is deliberate and written down');
    }
  }
}

for (const [file, count] of seen) {
  const allowed = ALLOWED_INLINE_SVG[file];
  if (allowed === undefined) {
    fail(file, 'new inline <svg> in a component', 'use a lucide icon; if it is a graphic rather than an icon, add the file to ALLOWED_INLINE_SVG in this script with a reason');
  } else if (count > allowed) {
    fail(file, `inline <svg> count grew from ${allowed} to ${count}`, 'the allowlist may only shrink');
  }
}

for (const [file, allowed] of Object.entries(ALLOWED_INLINE_SVG)) {
  const count = seen.get(file) ?? 0;
  if (count < allowed) {
    fail(
      file,
      `allowlist says ${allowed} inline <svg>, found ${count}`,
      count === 0 ? 'remove the entry — the debt is paid' : `lower the entry to ${count}`,
    );
  }
}

if (problems.length) {
  console.error(`\nicon canon: ${problems.length} problem(s)\n`);
  for (const p of problems) {
    console.error(`  ${p}\n`);
  }
  process.exit(1);
}

const debt = Object.values(ALLOWED_INLINE_SVG).reduce((a, b) => a + b, 0);
console.log(
  `icon canon holds: one lucide version, no per-site stroke, ${debt} inline <svg> left in ${Object.keys(ALLOWED_INLINE_SVG).length} files`,
);
