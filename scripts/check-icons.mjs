/**
 * Guards the icon canon (DESIGN_SYSTEM §4): one lucide version, one stroke
 * width, one size ladder, no fresh hand-written SVG in components.
 *
 * Run with `npm run check:icons`.
 *
 * Every rule here was written against a deliberate break first. Text matching
 * is unavoidable — but it is done on a real attribute block, not on a regex
 * that stops at the first `>` inside an arrow function.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function fail(where, what, how) {
  problems.push(`${where}\n    ${what}\n    → ${how}`);
}

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch (error) {
    fail(
      rel,
      `cannot be read (${error.code})`,
      'the file moved or went away — update this script so the canon stays guarded',
    );
    return null;
  }
}

/** Strips /* *\/ and // comments so an example in a doc block cannot trip a rule. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ------------------------------------------------------------------ *
 * 1. One lucide version everywhere, including the strings that tell the
 *    artifact sandbox which lucide to load.
 * ------------------------------------------------------------------ */
const PINS = [
  ['client/package.json', /"lucide-react":\s*"([^"]+)"/g],
  ['packages/client/package.json', /"lucide-react":\s*"([^"]+)"/g],
  ['client/src/utils/artifacts.ts', /['"]lucide-react['"]\s*:\s*['"]([^'"]+)['"]/g],
  ['packages/api/src/prompts/artifacts/index.ts', /lucide-react@(\S+?)[\s`'"]/g],
  ['api/app/clients/prompts/artifacts.js', /lucide-react@(\S+?)[\s`'"]/g],
];

const versions = new Map();
for (const [file, re] of PINS) {
  const text = read(file);
  if (text === null) {
    continue;
  }
  const found = [...text.matchAll(re)].map(([, v]) => v.replace(/^[\^~]/, ''));
  if (!found.length) {
    // Silence here is the dangerous case: an unrecognised spelling would drop
    // the file out of the comparison and the pins could drift unnoticed.
    fail(
      file,
      'names no lucide version in a shape this check recognises',
      'either restore the pin or teach PINS in this script the new spelling',
    );
    continue;
  }
  for (const version of found) {
    if (!versions.has(version)) {
      versions.set(version, new Set());
    }
    versions.get(version).add(file);
  }
}

// An override in the root manifest silently wins over every workspace range.
const rootManifest = read('package.json');
if (rootManifest) {
  for (const field of ['overrides', 'resolutions']) {
    const pinned = JSON.parse(rootManifest)[field]?.['lucide-react'];
    if (pinned) {
      const version = String(pinned).replace(/^[\^~]/, '');
      if (!versions.has(version)) {
        versions.set(version, new Set());
      }
      versions.get(version).add(`package.json (${field})`);
    }
  }
}

if (versions.size > 1) {
  const seen = [...versions].map(([v, files]) => `${v} (${[...files].join(', ')})`);
  fail(
    'lucide-react',
    `pinned to more than one version: ${seen.join('; ')}`,
    'pick one and change every pin together — the app, the component package and the artifact sandbox all draw the same icons',
  );
}

/* ------------------------------------------------------------------ *
 * 2. The icon block in style.css: exactly one rule, in the one position
 *    where both of its jobs work, reading a token that exists.
 * ------------------------------------------------------------------ */
const cssRaw = read('client/src/style.css');
if (cssRaw !== null) {
  const css = stripComments(cssRaw);
  const rules = [...css.matchAll(/\.lucide\b[^{}]*\{([^}]*)\}/g)].filter(([, body]) =>
    /stroke-width\s*:/.test(body),
  );

  if (rules.length !== 1) {
    fail(
      'client/src/style.css',
      rules.length === 0
        ? 'no rule sets stroke-width for .lucide'
        : `${rules.length} rules set stroke-width for .lucide — the later one silently wins`,
      'keep exactly one: it is what gives every icon the canonical width',
    );
  } else {
    const [rule] = rules;
    const components = css.indexOf('@tailwind components;');
    const utilities = css.indexOf('@tailwind utilities;');
    if (!(components < rule.index && rule.index < utilities)) {
      fail(
        'client/src/style.css',
        'the icon rule no longer sits between the components and utilities directives',
        'move it back: below the utilities a deliberate stroke-[1.5] in markup stops working',
      );
    }

    // @layer, found by brace counting — the rule may sit anywhere inside one.
    let depth = 0;
    let inLayer = false;
    for (let i = 0; i < rule.index; i += 1) {
      if (css[i] === '{') {
        depth += 1;
      } else if (css[i] === '}') {
        depth -= 1;
        if (depth <= 0) {
          inLayer = false;
          depth = Math.max(depth, 0);
        }
      } else if (css.startsWith('@layer', i) && depth === 0) {
        inLayer = true;
      }
    }
    if (inLayer && depth > 0) {
      fail(
        'client/src/style.css',
        'the icon rule was wrapped in @layer',
        'unwrap it — Tailwind drops rules inside a layer when it cannot find the class in the source, and this one would vanish silently',
      );
    }

    const token = rule[1].match(/var\(\s*(--[\w-]+)/)?.[1];
    if (token && !new RegExp(`${token}\\s*:`).test(css)) {
      fail(
        'client/src/style.css',
        `the rule reads ${token}, which nothing declares`,
        'an undeclared custom property makes the declaration invalid and every icon falls back to a hairline',
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Walk the component sources once for rules 3 and 4.
 * ------------------------------------------------------------------ */
const SRC = ['client/src', 'packages/client/src'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '__tests__', '__mocks__']);
const ICON_LIB = join(ROOT, 'packages/client/src/svgs') + sep;
const COMPONENT = /\.(tsx|jsx)$/;
/* The lucide-import ban scans plain .ts too: hooks and option tables import
   icon components without a line of JSX (useChatBadges.ts, iconOptions.ts),
   and a probe planted in a .ts file walked straight past the component-only
   walker on the first mutation run. */
const ANY_SOURCE = /\.(tsx|jsx|ts)$/;
const IS_TEST = /\.(spec|test)\.(tsx|jsx|ts)$/;

function* sources(dir, filter = COMPONENT) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) {
        yield* sources(path, filter);
      }
    } else if (entry.isFile() && filter.test(entry.name) && !IS_TEST.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Attributes of one capitalised JSX element, read by counting braces and
 * quotes rather than by regex — an `onClick={() => x}` holds a `>` and a
 * `className={cn(...)}` holds no quote at all right after the `=`.
 */
function* componentTags(text) {
  const open = /<([A-Z][\w.]*)(?=[\s/>])/g;
  for (const match of text.matchAll(open)) {
    // matchAll iterates over a clone, so the regex's own lastIndex never moves.
    const start = match.index + match[0].length;
    let i = start;
    let depth = 0;
    let quote = '';
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') {
          quote = '';
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '>' && depth === 0) {
        break;
      }
    }
    yield [match[1], text.slice(start, i)];
  }
}

/* ------------------------------------------------------------------ *
 * 3. Stroke width belongs to the canon, not to call sites. A capitalised
 *    tag setting it is an icon opting out; a plain <svg>/<path> is drawing
 *    a graphic and may keep its own.
 *
 *    The register below is for components that are not icons at all —
 *    a library's own arrow glyph the canon has no claim on.
 * ------------------------------------------------------------------ */
const ALLOWED_STROKE = {
  'client/src/components/Chat/Menus/Endpoints/CustomMenu.tsx': 1,
  'packages/client/src/components/DropdownPopup.tsx': 1,
  'packages/client/src/components/MultiSelect.tsx': 1,
};

/* ------------------------------------------------------------------ *
 * 4. Inline SVG in components. The allowlist is a debt register: it may
 *    shrink, never grow. Genuine graphics (progress rings, the context
 *    gauge, the drop overlay) and vendor marks live here on purpose;
 *    the rest are waiting for the screen batch that owns them.
 * ------------------------------------------------------------------ */
const ALLOWED_INLINE_SVG = {
  // Vendored aicss approval card: two GRAPHICS, not icons — the dashed
  // to-do circle and the more/less dots-bar glyph (the auto-approve pie,
  // the third, went with the countdown in r30).
  'client/src/components/Chat/Cards/ApprovalCard.tsx': 2,
  'client/src/components/Agents/ErrorDisplay.tsx': 1,
  'client/src/components/Chat/Input/Files/DragDropOverlay.tsx': 1,
  'client/src/components/Chat/Input/Files/ProgressCircle.tsx': 1,
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

/* The app draws Phosphor through the generated shims (src/components/icons.tsx,
   one per workspace, built from scripts/icons.map.json); lucide-react stays in
   package.json only for the artifact sandbox pin above. A direct import would
   quietly reintroduce the old drawing style next to the new one — exactly the
   mixed set the owner ruled out. Scans .ts as well as components. */
for (const root of SRC) {
  for (const path of sources(join(ROOT, root), ANY_SOURCE)) {
    const rel = relative(ROOT, path).split(sep).join('/');
    if (rel.endsWith('components/icons.tsx')) {
      continue;
    }
    const text = stripComments(readFileSync(path, 'utf8'));
    if (/from\s+['"]lucide-react['"]/.test(text)) {
      fail(
        rel,
        `imports straight from lucide-react`,
        `import the same name from '~/components/icons' — the shim maps it to Tabler (scripts/icons.map.json)`,
      );
    }
    if (/from\s+['"]@tabler\/icons-react['"]/.test(text)) {
      fail(
        rel,
        `imports straight from @tabler/icons-react`,
        `import a semantic name from '~/components/icons' — the shim owns the stroke and the mapping (scripts/icons.map.json)`,
      );
    }
  }
}

const LADDER = /\bicon-(xs|sm|md|lg|xl|2xl)\b/g;
const seenSvg = new Map();
const seenStroke = new Map();

for (const root of SRC) {
  for (const path of sources(join(ROOT, root))) {
    const rel = relative(ROOT, path).split(sep).join('/');
    const text = stripComments(readFileSync(path, 'utf8'));

    if (!path.startsWith(ICON_LIB)) {
      const count = (text.match(/<svg[\s/>]/g) ?? []).length;
      if (count) {
        seenSvg.set(rel, count);
      }
    }

    for (const [tag, attrs] of componentTags(text)) {
      if (/\bstrokeWidth\s*[=:]/.test(attrs) || /\bstroke\s*=\s*\{/.test(attrs)) {
        seenStroke.set(rel, (seenStroke.get(rel) ?? 0) + 1);
        if (!ALLOWED_STROKE[rel]) {
          fail(
            rel,
            `<${tag}> sets its own strokeWidth`,
            'drop it — the canon owns stroke width; if this really is an exception, say so in markup with a stroke-[…] class',
          );
        }
      } else if (/\bstroke-\d/.test(attrs)) {
        seenStroke.set(rel, (seenStroke.get(rel) ?? 0) + 1);
        if (!ALLOWED_STROKE[rel]) {
          fail(
            rel,
            `<${tag}> carries a stroke-N class`,
            'drop it, or use stroke-[…] to say the deviation is deliberate',
          );
        }
      }
      const rungs = new Set((attrs.match(LADDER) ?? []).map((c) => c));
      if (rungs.size > 1) {
        fail(
          rel,
          `<${tag}> carries two ladder classes (${[...rungs].join(' ')})`,
          'they have equal weight, so the stylesheet order decides and the markup lies — keep one',
        );
      }
    }
  }
}

function checkRegister(register, seen, noun, howNew) {
  for (const [file, count] of seen) {
    const allowed = register[file];
    if (allowed === undefined) {
      fail(file, `new ${noun}`, howNew);
    } else if (count > allowed) {
      fail(file, `${noun} count grew from ${allowed} to ${count}`, 'the register may only shrink');
    }
  }
  for (const [file, allowed] of Object.entries(register)) {
    const count = seen.get(file) ?? 0;
    if (count < allowed) {
      fail(
        file,
        `register says ${allowed} ${noun}, found ${count}`,
        count === 0 ? 'remove the entry — the debt is paid' : `lower the entry to ${count}`,
      );
    }
  }
}

checkRegister(
  ALLOWED_INLINE_SVG,
  seenSvg,
  'inline <svg> in a component',
  'use a lucide icon; if it is a graphic rather than an icon, add the file to ALLOWED_INLINE_SVG in this script with a reason',
);
checkRegister(ALLOWED_STROKE, seenStroke, 'component-level stroke width', 'see above');

if (problems.length) {
  console.error(`\nicon canon: ${problems.length} problem(s)\n`);
  for (const problem of problems) {
    console.error(`  ${problem}\n`);
  }
  process.exit(1);
}

const debt = Object.values(ALLOWED_INLINE_SVG).reduce((a, b) => a + b, 0);
console.log(
  `icon canon holds: one lucide version, ${debt} inline <svg> left in ${Object.keys(ALLOWED_INLINE_SVG).length} files, ${Object.keys(ALLOWED_STROKE).length} non-icon stroke exceptions`,
);
