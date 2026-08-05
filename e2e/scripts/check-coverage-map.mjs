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
const STATUS_REQUIRES_TEST = new Set(['covered', 'fixme:Ф1']);
const STATUS_FORBIDS_TEST = new Set(['gap', 'todo:Ф1']);

const isStatus = (value) =>
  value === 'covered' ||
  value === 'gap' ||
  value === 'fixme:Ф1' ||
  value === 'todo:Ф1' ||
  /^planned:[A-ZЭ][0-9]$/u.test(value);

const problems = [];
const stats = { rows: 0, covered: 0, planned: 0, fixme: 0, todo: 0, gap: 0 };

const lines = readFileSync(mapPath, 'utf8').split('\n');

lines.forEach((line, index) => {
  const lineNo = index + 1;
  if (!line.startsWith('|')) {
    return;
  }
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length !== 4) {
    return;
  }
  const [behavior, level, owner, status] = cells;
  if (behavior === 'Behavior' || /^-+$/.test(behavior)) {
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
  if (STATUS_REQUIRES_TEST.has(status) && !hasTest) {
    problems.push(`${lineNo}: status "${status}" but no owning test named — "${behavior}"`);
  }
  if (STATUS_FORBIDS_TEST.has(status) && hasTest) {
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
    if (anchor && !readFileSync(absolute, 'utf8').includes(anchor)) {
      problems.push(`${lineNo}: "${path}" no longer contains its anchor — "${anchor}"`);
    }
  }
});

if (stats.rows === 0) {
  problems.push('no behavior rows parsed — the map format changed and this guard went blind');
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
