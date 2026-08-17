#!/usr/bin/env node
/**
 * Every workspace that runs jest must keep the workspace-build guard wired.
 *
 * That guard (`scripts/jest-workspace-build.cjs`) is what tells a developer their
 * suite is about to load shared packages belonging to a different checkout — the
 * failure mode that had three orchestrator tests red on one machine and green in
 * CI for the same commit. A guard nobody runs is not a guard, and a one-line
 * `globalSetup` is exactly the kind of line that disappears in a merge.
 *
 * Configs are discovered rather than listed, so a new workspace cannot opt out by
 * not being on somebody's list, and this refuses to pass when it finds nothing to
 * inspect.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'jest-workspace-build.cjs';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.turbo', 'e2e']);
const require = createRequire(import.meta.url);

function findJestConfigs(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        findJestConfigs(join(dir, entry.name), found);
      }
      continue;
    }
    if (/^jest\.config\.[cm]?js$/.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/** Read the config as data rather than guessing at its text. */
async function loadConfig(configPath) {
  let loaded;
  try {
    loaded = (await import(pathToFileURL(configPath).href)).default;
  } catch {
    loaded = require(configPath);
  }
  const value = typeof loaded === 'function' ? await loaded() : await loaded;
  return value?.default ?? value ?? {};
}

const problems = [];
const configs = findJestConfigs(ROOT);

for (const configPath of configs) {
  const where = relative(ROOT, configPath);
  const workspace = dirname(configPath);
  const { globalSetup } = await loadConfig(configPath);

  if (typeof globalSetup !== 'string' || !globalSetup.endsWith(GUARD)) {
    problems.push(`${where}: does not wire ${GUARD} as its globalSetup`);
    continue;
  }
  const onDisk = resolve(workspace, globalSetup.replace('<rootDir>', '.'));
  if (!existsSync(onDisk)) {
    problems.push(`${where}: globalSetup points at ${globalSetup}, which does not exist on disk`);
  }
}

/** Self-check: a guard that inspected nothing passes everything. */
if (configs.length === 0) {
  problems.push('found no jest configs at all — this check is not looking where it thinks it is');
}
if (!existsSync(join(ROOT, 'scripts', GUARD))) {
  problems.push(`scripts/${GUARD} is missing — there is nothing left to wire`);
}

if (problems.length > 0) {
  console.error(`\nJest guard check failed (${configs.length} configs inspected):\n`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(`\nAdd to the workspace's jest config:\n  globalSetup: '<rootDir>/…/scripts/${GUARD}',\n`);
  process.exit(1);
}

console.log(`Jest guard check: ${configs.length} configs wire ${GUARD}.`);
