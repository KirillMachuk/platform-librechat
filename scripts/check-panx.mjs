/**
 * Guards the sideways-jitter rule: a horizontal scroller keeps its overscroll
 * to itself.
 *
 * The app shell is a stack of vertical scrollers, and `overflow-y: auto`
 * computes `overflow-x: auto` — so when a finger drags a code block, a wide
 * table or a chip ribbon past its end, iOS chains the leftover swipe to the
 * PARENT and the whole chat rubber-bands sideways. That is the "дёргание" the
 * owner reported twice (14.08 sidebar, 15.08 chat); the table wrapper had
 * `overscroll-behavior-x: contain` from the start, every other ribbon did not.
 *
 * The rule: every `overflow-x-auto` / `overflow-x-scroll` in app code carries
 * `pan-x` (client/src/style.css) in the same className.
 *
 * Run with `npm run check:panx`.
 *
 * Matching is by file + a `marker` substring of the offending className, not by
 * line number: line numbers drift with every edit above the site and a drifted
 * allowlist silently allows the wrong thing. A marker that matches nothing
 * fails the run — a stale entry is itself a defect (the "matcher that matches
 * nothing" lesson).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['client/src', 'packages/client/src'];
const EXTENSIONS = /\.(tsx|jsx)$/;
const SKIP = /__tests__|\.(spec|test)\.[tj]sx?$/;

/** Scrollers that legitimately do not need the class. */
const ALLOWLIST = [];

const SCROLLER = /overflow-x-(auto|scroll)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.test(entry.name) && !SKIP.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The className a scroller lives in — everything between the nearest quote
 * boundaries around the match. Classes are frequently split across lines by
 * prettier, so the window is the enclosing string literal, not the line.
 */
function classNameAround(source, index) {
  const openers = ['"', "'", '`'];
  let start = index;
  while (start > 0 && !openers.includes(source[start])) {
    start -= 1;
  }
  let end = index;
  while (end < source.length && !openers.includes(source[end])) {
    end += 1;
  }
  return source.slice(start + 1, end);
}

/**
 * Comments mention these class names when they explain them — the first run of
 * this guard flagged its own explanatory comment in RemoveFile.tsx. Blank the
 * block comments out (keeping length, so match indices stay valid) before
 * scanning, so only real markup is judged.
 */
function withoutBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => ' '.repeat(block.length));
}

const offenders = [];
const usedAllowlist = new Set();

for (const rootDir of ROOTS) {
  for (const file of walk(join(ROOT, rootDir))) {
    const source = withoutBlockComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file).split('\\').join('/');
    for (const match of source.matchAll(new RegExp(SCROLLER, 'g'))) {
      const className = classNameAround(source, match.index);
      if (/\bpan-x\b/.test(className)) {
        continue;
      }
      const allowed = ALLOWLIST.find(
        (entry) => entry.file === rel && className.includes(entry.marker),
      );
      if (allowed) {
        usedAllowlist.add(`${allowed.file}|${allowed.marker}`);
        continue;
      }
      offenders.push({ file: rel, className: className.trim().slice(0, 120) });
    }
  }
}

const stale = ALLOWLIST.filter((entry) => !usedAllowlist.has(`${entry.file}|${entry.marker}`));

if (offenders.length > 0 || stale.length > 0) {
  if (offenders.length > 0) {
    console.error(
      `Horizontal scrollers without \`pan-x\` (${offenders.length}) — they chain their overscroll to the page:`,
    );
    for (const offender of offenders) {
      console.error(`  ${offender.file}\n    ${offender.className}`);
    }
    console.error('\nAdd `pan-x` to the className (see client/src/style.css).');
  }
  if (stale.length > 0) {
    console.error(`\nStale allowlist entries (${stale.length}) — they match nothing any more:`);
    for (const entry of stale) {
      console.error(`  ${entry.file} — "${entry.marker}"`);
    }
  }
  process.exit(1);
}

console.log('Sideways-pan canon: every horizontal scroller contains its own overscroll.');
