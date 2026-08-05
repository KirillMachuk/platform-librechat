#!/usr/bin/env node
/**
 * Guards e2e/COVERAGE_MAP.md against rot.
 *
 * The map claims which test owns which user behavior. Two ways that claim rots: the test is
 * renamed or deleted, and the test stays but stops being about the behavior. The first is
 * caught by checking every referenced path exists. The second is caught by the anchor form
 * `path#substring` — the substring (a test title, an assertion, a constant) must still be
 * present in that file. Rows without an anchor are only as trustworthy as their last reader.
 *
 * The status column is checked against whether a test is named at all, which is what keeps
 * `fixme` from quietly meaning "nothing here".
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const mapPath = join(repoRoot, 'e2e', 'COVERAGE_MAP.md');

const LEVELS = new Set(['unit', 'e2e', 'a11y', 'visual']);
const NO_TEST = '—';
/* By prefix, not by exact string: the stage a row waits on is not always Ф1,
 * and hardcoding it meant `fixme:Э5` quietly escaped the "must name a test"
 * rule instead of being rejected as an unknown status. */
const requiresTest = (status) => status === 'covered' || status.startsWith('fixme:');
const forbidsTest = (status) => status === 'gap' || status.startsWith('todo:');

const isStatus = (value) =>
  value === 'covered' ||
  value === 'gap' ||
  /^(?:planned|fixme|todo):[A-ZА-ЯЁ][0-9]{1,2}$/u.test(value);

/**
 * Comments do not count as evidence. An anchor is supposed to prove the file
 * still carries the behavior, and three rows here anchored on a comment inside
 * a test — deleting that test outright, comments left behind, kept this guard
 * green. Block comments and whole-line `//` go, the same narrow rule
 * `client/src/locales/keys.spec.ts` uses: stripping every `//` to end of line
 * would eat a URL in a string and take real code with it.
 */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * A `covered` row must not point at a test that does not run. Playwright marks
 * a test skipped from inside its body (`test.fixme()` on the first line), so
 * looking at the opener is not enough — the body has to be read. Only applies
 * when the anchor is a test title, which is the form that can be located.
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const QUARANTINE = /\b(?:test|it)\.(?:skip|fixme|fail|failing|todo)\s*\(/;
const quarantinedTest = (source, anchor) => {
  const opener = new RegExp(`\\b(?:test|it)(?:\\.\\w+)?\\s*\\(\\s*['"\`]${escapeRegExp(anchor)}`);
  const match = opener.exec(source);
  if (!match) {
    return null;
  }
  if (/\.(?:skip|fixme|fail)\s*\($/.test(match[0].replace(/\s*['"`].*$/, ''))) {
    return match[0].trim();
  }
  const rest = source.slice(match.index + match[0].length);
  /* The body ends where the next test begins, or at the end of the file. */
  const next = rest.search(/\n\s*(?:test|it)(?:\.\w+)?\s*\(/);
  const body = next === -1 ? rest : rest.slice(0, next);
  const marked = QUARANTINE.exec(body);
  return marked ? marked[0] : null;
};

const problems = [];
const stats = { rows: 0, covered: 0, planned: 0, fixme: 0, todo: 0, gap: 0 };

const lines = readFileSync(mapPath, 'utf8').split('\n');

let insideFence = false;

lines.forEach((line, index) => {
  const lineNo = index + 1;
  /* Rows inside a fenced block are documentation, not claims. Left in, an
   * example row was counted as a behavior and a broken one failed the build. */
  if (/^\s*```/.test(line)) {
    insideFence = !insideFence;
    return;
  }
  if (insideFence) {
    return;
  }
  /* Trimmed, because markdown allows up to three spaces of indent and an
   * indented row used to vanish from this guard entirely — along with whatever
   * it claimed. */
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return;
  }
  const cells = trimmed
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length !== 4) {
    /* Not a silent `return`. A row with an escaped pipe in its text, or without
     * its closing pipe, is still a row a reader sees — and it used to disappear
     * from here while claiming `covered` for a file that does not exist. */
    problems.push(
      `${lineNo}: table row has ${cells.length} columns, expected 4 — "${trimmed.slice(0, 70)}"`,
    );
    return;
  }
  const [behavior, level, owner, status] = cells;
  if (/^-+:?$|^:?-+:?$/.test(behavior)) {
    return;
  }
  if (behavior === 'Behavior') {
    if (level !== 'Level') {
      problems.push(`${lineNo}: a behavior may not be called "Behavior" — it reads as a header`);
    }
    return;
  }

  stats.rows += 1;

  if (!LEVELS.has(level)) {
    problems.push(`${lineNo}: unknown level "${level}" (expected ${[...LEVELS].join('/')})`);
  }
  if (!isStatus(status)) {
    problems.push(`${lineNo}: unknown status "${status}"`);
  }

  if (status === 'covered') {
    stats.covered += 1;
  } else if (status.startsWith('planned')) {
    stats.planned += 1;
  } else if (status.startsWith('fixme')) {
    stats.fixme += 1;
  } else if (status.startsWith('todo')) {
    stats.todo += 1;
  } else if (status === 'gap') {
    stats.gap += 1;
  }

  const hasTest = owner !== NO_TEST;
  if (requiresTest(status) && !hasTest) {
    problems.push(`${lineNo}: status "${status}" but no owning test named — "${behavior}"`);
  }
  if (forbidsTest(status) && hasTest) {
    problems.push(`${lineNo}: status "${status}" must not name a test — "${behavior}"`);
  }
  if (!hasTest) {
    return;
  }

  const paths = [...owner.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  if (paths.length === 0) {
    problems.push(`${lineNo}: owning test must be a backtick-quoted path — "${owner}"`);
    return;
  }
  for (const reference of paths) {
    const separator = reference.indexOf('#');
    const path = separator === -1 ? reference : reference.slice(0, separator);
    const anchor = separator === -1 ? '' : reference.slice(separator + 1);
    if (!/\.(ts|tsx)$/.test(path)) {
      problems.push(`${lineNo}: owning test is not a .ts/.tsx file — "${path}"`);
      continue;
    }
    const absolute = join(repoRoot, path);
    if (!existsSync(absolute)) {
      problems.push(`${lineNo}: owning test does not exist — "${path}"`);
      continue;
    }
    if (separator !== -1 && anchor.length === 0) {
      problems.push(`${lineNo}: empty anchor after "#" — "${reference}"`);
      continue;
    }
    if (!anchor) {
      continue;
    }
    /* An anchor shorter than this matches by accident: a single letter is in
     * every file. Long enough to be a test title or a whole assertion. */
    if (anchor.length < 8) {
      problems.push(`${lineNo}: anchor is too short to mean anything — "${anchor}"`);
      continue;
    }
    const source = readFileSync(absolute, 'utf8');
    if (!withoutComments(source).includes(anchor)) {
      const inComment = source.includes(anchor);
      problems.push(
        inComment
          ? `${lineNo}: "${path}" has its anchor only in a comment — "${anchor}"`
          : `${lineNo}: "${path}" no longer contains its anchor — "${anchor}"`,
      );
      continue;
    }
    if (status === 'covered') {
      const quarantined = quarantinedTest(source, anchor);
      if (quarantined) {
        problems.push(
          `${lineNo}: "covered" but the test is quarantined (${quarantined}) — "${anchor}"`,
        );
      }
    }
  }
});

if (stats.rows === 0) {
  problems.push('no behavior rows parsed — the map format changed and this guard went blind');
}
/* A floor, not a checksum. The map has grown past 180 rows; anything that
 * parses a fraction of that has lost most of the file to a format change, and
 * the old backstop at zero could not see it. */
if (stats.rows > 0 && stats.rows < 150) {
  problems.push(
    `only ${stats.rows} behavior rows parsed — the map has ~185; most of it went unread`,
  );
}

if (problems.length > 0) {
  console.error(`COVERAGE_MAP.md: ${problems.length} problem(s)\n`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

console.log(
  `COVERAGE_MAP.md ok — ${stats.rows} behaviors: ${stats.covered} covered, ` +
    `${stats.planned} planned, ${stats.fixme} pinned awaiting Ф1, ${stats.todo} untested ` +
    `awaiting Ф1, ${stats.gap} gaps`,
);
