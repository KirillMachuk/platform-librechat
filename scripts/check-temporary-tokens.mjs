/**
 * Guards the temporary-chat inversion: every color token the composer subtree
 * paints with must be remapped inside `.composer-temporary` in
 * client/src/style.css.
 *
 * Why: the temporary composer flips into the ink palette via a LOCAL token
 * remap. A descendant class whose token is NOT in that block keeps the normal
 * theme's value while its NEIGHBORS flip — this shipped twice: round 13
 * missed `--surface-active` and the ink pair (invisible send arrow), round 14
 * missed `--surface-primary`/`--surface-primary-alt` (the §6.3 chips stayed
 * white pills with white text, owner 18.08-3). The set must be checked by a
 * machine, not by reading.
 *
 * The rule: for every utility class of the token families
 * surface-* / text-* / border-* / ink* used by a file that renders INSIDE the
 * composer shell, the backing custom property must appear in the
 * `.composer-temporary` block (or be a listed intentional exemption).
 * Files that render through portals (dialogs, sheets, popovers mount at body,
 * OUTSIDE the scope) are allowlisted with the reason.
 *
 * Legacy `*-token-*` alias classes are not tracked — they are being phased
 * out and none paint inside the shell today.
 *
 * Run with `npm run check:temporary`. Exit 0 clean, 1 violations, 2 broken
 * self-check.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_FILE = 'client/src/style.css';

/** Files rendered inside the composer shell live here (superset; portal files
 *  below are excluded). packages/client contributes the chip/badge recipes. */
const SCAN_ROOTS = ['client/src/components/Chat/Input'];
const EXTRA_FILES = [
  'packages/client/src/components/Badge.tsx',
  'packages/client/src/components/CheckboxButton.tsx',
];
const EXTENSIONS = /\.tsx$/;
const SKIP = /__tests__|\.(spec|test)\.tsx$/;

/** Portal or out-of-scope files: their DOM mounts outside the
 *  `.composer-temporary` element, so the remap never reaches them — and must
 *  not be forced to. Files whose TRIGGER lives in the shell while only the
 *  menu/popover portals out (MCPSelect, TokenUsage) are deliberately NOT
 *  listed: scanning their portal-content tokens is a harmless superset,
 *  skipping their trigger classes was a real blind spot (review, 18.08).
 *  Staleness: a listed file that no longer exists fails the run. */
const FILE_ALLOWLIST = [
  { file: 'client/src/components/Chat/Input/PlusSheet.tsx', reason: 'Headless UI Dialog — sheet portals to body' },
  { file: 'client/src/components/Chat/Input/Files/DragDropModal.tsx', reason: 'OGDialog (Radix portal)' },
  { file: 'client/src/components/Chat/Input/Mention.tsx', reason: 'renders as a sibling ABOVE the composer shell (ChatForm), outside the scope' },
  { file: 'client/src/components/Chat/Input/PromptsCommand.tsx', reason: 'sibling above the shell, outside the scope' },
  { file: 'client/src/components/Chat/Input/SkillsCommand.tsx', reason: 'sibling above the shell, outside the scope' },
  { file: 'client/src/components/Chat/Input/ConversationStarters.tsx', reason: 'renders on the landing below the form, outside the shell' },
  { file: 'client/src/components/Chat/Input/OptionsPopover.tsx', reason: 'legacy popover surface, portals via Popover; not part of the composer shell' },
];

/** Tokens intentionally NOT flipped inside the temporary pill. */
const TOKEN_EXEMPT = new Map([
  ['border-focus', 'focus accent is the same in both schemes by design'],
  ['border-control', 'control accent (checkbox/switch) unchanged by the inversion'],
]);

/** class color-name -> custom property behind it (tailwind.config.cjs). Names
 *  whose var differs from `--<name>` must be listed explicitly — a wrong guess
 *  fails in the false-positive direction (safe but confusing). */
function tokenToVar(name) {
  if (name === 'ink') return '--c-ink';
  if (name === 'ink-label') return '--c-ink-label';
  if (name === 'text-accent') return '--c-acc';
  if (name === 'surface-code') return '--c-code-bg';
  return `--${name}`;
}

const FAMILY_RE =
  /(?:^|[\s:'"`([\]!])(?:bg|text|border|divide|placeholder|caret|fill|stroke|outline|ring|decoration|accent)-((?:surface|text|border)(?:-[a-z0-9]+)+|ink(?:-label)?)(?![a-z0-9-])/g;

/** Arbitrary-value classes paint straight from a custom property and slip past
 *  FAMILY_RE — e.g. `bg-[var(--c-ink)]` in RemoveFile/SourceIcon. Matched vars
 *  are checked against the remap directly (review finding, 18.08). */
const ARBITRARY_VAR_RE =
  /(?:bg|text|border|divide|placeholder|caret|fill|stroke|outline|ring|decoration|accent|shadow)-\[var\((--[a-z0-9-]+)\)\]/g;

function extractRemappedVars(cssText) {
  const m = cssText.match(/\.composer-temporary\s*\{([^}]*)\}/);
  if (!m) return null;
  const vars = new Set();
  for (const prop of m[1].matchAll(/--[a-z-]+(?=\s*:)/g)) {
    vars.add(prop[0]);
  }
  return vars;
}

function extractUsedTokens(fileText) {
  const tokens = new Set();
  for (const m of fileText.matchAll(FAMILY_RE)) {
    tokens.add(m[1]);
  }
  return tokens;
}

function extractArbitraryVars(fileText) {
  const vars = new Set();
  for (const m of fileText.matchAll(ARBITRARY_VAR_RE)) {
    vars.add(m[1]);
  }
  return vars;
}

/** Vars that arbitrary-value classes may use without a remap entry. */
const VAR_EXEMPT = new Map([
  ['--border-focus', 'focus accent is the same in both schemes by design'],
  ['--border-control', 'control accent unchanged by the inversion'],
  ['--c-acc', 'the accent is theme-stable by design — same value on light and dark grounds (context gauge)'],
]);

function findViolations(remappedVars, files) {
  const violations = [];
  for (const { path, text } of files) {
    for (const token of extractUsedTokens(text)) {
      if (TOKEN_EXEMPT.has(token)) continue;
      const varName = tokenToVar(token);
      if (!remappedVars.has(varName)) {
        violations.push({ path, token, varName });
      }
    }
    for (const varName of extractArbitraryVars(text)) {
      if (VAR_EXEMPT.has(varName)) continue;
      if (!remappedVars.has(varName)) {
        violations.push({ path, token: `[var(${varName})]`, varName });
      }
    }
  }
  return violations;
}

function selfCheck() {
  const fullSet = new Set(['--surface-primary', '--surface-primary-alt', '--text-primary']);
  const holedSet = new Set(['--surface-primary', '--text-primary']);
  const founding = [{ path: 'fixture.tsx', text: `className={cn('bg-surface-primary-alt text-text-primary')}` }];
  const mustCatch = findViolations(holedSet, founding);
  if (mustCatch.length !== 1 || mustCatch[0].token !== 'surface-primary-alt') {
    console.error('[check-temporary] SELF-CHECK FAILED: the founding case (missing --surface-primary-alt) was not caught.');
    return false;
  }
  if (findViolations(fullSet, founding).length !== 0) {
    console.error('[check-temporary] SELF-CHECK FAILED: a fully remapped fixture was flagged.');
    return false;
  }
  const exempt = [{ path: 'fixture.tsx', text: `'focus-visible:outline-border-focus'` }];
  if (findViolations(holedSet, exempt).length !== 0) {
    console.error('[check-temporary] SELF-CHECK FAILED: token exemption did not apply.');
    return false;
  }
  const arbitrary = [{ path: 'fixture.tsx', text: `className="bg-[var(--surface-dialog)] text-[var(--text-primary)]"` }];
  const arbCatch = findViolations(new Set(['--text-primary']), arbitrary);
  if (arbCatch.length !== 1 || arbCatch[0].varName !== '--surface-dialog') {
    console.error('[check-temporary] SELF-CHECK FAILED: arbitrary [var(--...)] class was not caught.');
    return false;
  }
  return true;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      yield* walk(p);
    } else if (EXTENSIONS.test(p) && !SKIP.test(p)) {
      yield p;
    }
  }
}

function main() {
  if (!selfCheck()) return 2;

  const allowSet = new Set(FILE_ALLOWLIST.map((a) => a.file));
  for (const entry of FILE_ALLOWLIST) {
    if (!existsSync(join(ROOT, entry.file))) {
      console.error(`[check-temporary] stale allowlist entry (file gone): ${entry.file}`);
      return 1;
    }
  }

  const cssText = readFileSync(join(ROOT, STYLE_FILE), 'utf8');
  const remappedVars = extractRemappedVars(cssText);
  if (remappedVars == null || remappedVars.size === 0) {
    console.error(`[check-temporary] .composer-temporary block not found in ${STYLE_FILE} — the matcher matches nothing.`);
    return 1;
  }

  const files = [];
  for (const root of SCAN_ROOTS) {
    for (const p of walk(join(ROOT, root))) {
      const rel = relative(ROOT, p);
      if (allowSet.has(rel)) continue;
      files.push({ path: rel, text: readFileSync(p, 'utf8') });
    }
  }
  for (const rel of EXTRA_FILES) {
    files.push({ path: rel, text: readFileSync(join(ROOT, rel), 'utf8') });
  }

  const violations = findViolations(remappedVars, files);
  if (violations.length > 0) {
    console.error('[check-temporary] tokens used inside the composer subtree but NOT remapped in .composer-temporary:');
    for (const v of violations) {
      console.error(`  ${v.path}: ${v.token} (${v.varName})`);
    }
    console.error('Remap the token in the .composer-temporary block of client/src/style.css, or allowlist the file (portals only) with a reason.');
    return 1;
  }

  console.log(`[check-temporary] OK: ${files.length} files, ${remappedVars.size} remapped tokens, 0 gaps.`);
  return 0;
}

process.exit(main());
