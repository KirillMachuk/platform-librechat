#!/usr/bin/env node
/**
 * Guards e2e/COVERAGE_MAP.md against rot.
 *
 * The map claims which test owns which user behavior. A renamed or deleted test would
 * silently turn a claim into a lie, so every referenced path is checked to exist, and the
 * status column is checked to agree with whether a test is named at all.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const mapPath = join(repoRoot, 'e2e', 'COVERAGE_MAP.md');

const LEVELS = new Set(['unit', 'e2e', 'a11y', 'visual']);
const NO_TEST = '—';
const STATUS_REQUIRES_TEST = new Set(['covered']);
const STATUS_FORBIDS_TEST = new Set(['gap']);

const isStatus = (value) =>
  value === 'covered' ||
  value === 'gap' ||
  value === 'fixme:Ф1' ||
  /^planned:[A-ZЭ][0-9]$/u.test(value);

const problems = [];
const stats = { rows: 0, covered: 0, planned: 0, fixme: 0, gap: 0 };

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
  for (const path of paths) {
    if (!/\.(ts|tsx)$/.test(path)) {
      problems.push(`${lineNo}: owning test is not a .ts/.tsx file — "${path}"`);
      continue;
    }
    if (!existsSync(join(repoRoot, path))) {
      problems.push(`${lineNo}: owning test does not exist — "${path}"`);
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
    `${stats.planned} planned, ${stats.fixme} awaiting Ф1, ${stats.gap} gaps`,
);
