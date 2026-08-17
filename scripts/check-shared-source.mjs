#!/usr/bin/env node
/**
 * Every workspace that imports `librechat-data-provider` must point its tests at
 * the package's SOURCE, never at its build output.
 *
 * `packages/data-provider/dist` is a gitignored artifact that only CI and the
 * Docker build regenerate. On a developer machine it simply rots: measured on
 * 2026-08-17, the local copy was 12 days behind the source and missing 23 of the
 * 24 exports added in that window. Tests reading it therefore disagreed with CI —
 * some went red (`AutoModes` resolved to `undefined`, so the Auto orchestrator's
 * mode resolution threw), and, worse, any test whose subject tolerates a falsy
 * import went green having checked nothing at all.
 *
 * Source cannot go stale, so the mapping is the fix and this is its guard.
 *
 * Two further rules the mapping must obey:
 *  - the target must not be reached through `node_modules`. That symlink resolves
 *    to the primary checkout, so a git worktree would silently test whichever
 *    branch that checkout is sitting on rather than its own.
 *  - the target must exist, so a typo fails here rather than as a puzzling
 *    "cannot find module" inside one suite.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = 'librechat-data-provider';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.turbo', 'e2e']);
const require = createRequire(import.meta.url);

/** Every jest config in the repo, found rather than listed, so a new workspace
 *  cannot quietly opt out of the rule by not being on a hard-coded list. */
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

/** Does this workspace's own code import the shared package at all? */
function importsPackage(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) {
        continue;
      }
      if (readFileSync(full, 'utf8').includes(`'${PACKAGE}`)) {
        return true;
      }
    }
  }
  return false;
}

const problems = [];
const configs = findJestConfigs(ROOT);
let inspected = 0;

for (const configPath of configs) {
  const workspace = dirname(configPath);
  if (!importsPackage(workspace)) {
    continue;
  }
  inspected++;
  const where = relative(ROOT, configPath);
  const mapper = (await loadConfig(configPath)).moduleNameMapper ?? {};
  const targets = Object.entries(mapper)
    .filter(([pattern]) => pattern.includes(PACKAGE))
    .flatMap(([, target]) => (Array.isArray(target) ? target : [target]));

  if (targets.length === 0) {
    problems.push(
      `${where}: no moduleNameMapper entry for "${PACKAGE}" — its tests read the stale build`,
    );
    continue;
  }

  for (const target of targets) {
    if (target.includes('node_modules')) {
      problems.push(
        `${where}: reaches "${PACKAGE}" through node_modules (${target}) — a worktree would test the primary checkout's branch`,
      );
      continue;
    }
    if (!target.includes('/src')) {
      problems.push(
        `${where}: maps "${PACKAGE}" to ${target}, which is build output rather than source`,
      );
      continue;
    }
    const onDisk = resolve(workspace, target.replace('<rootDir>', '.'));
    const candidates = [onDisk, `${onDisk}.ts`, `${onDisk}.tsx`, join(onDisk, 'index.ts')];
    if (!candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())) {
      problems.push(`${where}: maps "${PACKAGE}" to ${target}, which does not exist on disk`);
    }
  }
}

/** Self-check: a guard that inspected nothing passes everything. */
if (configs.length === 0) {
  problems.push('found no jest configs at all — this guard is not looking where it thinks it is');
}
if (inspected === 0) {
  problems.push(`found no workspace importing "${PACKAGE}" — the import scan is broken`);
}

if (problems.length > 0) {
  console.error(`\nShared-package source guard failed (${inspected} workspaces inspected):\n`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    `\nEach workspace's jest moduleNameMapper needs a relative path to source:\n` +
      `  '^${PACKAGE}$': '<rootDir>/<...>/packages/data-provider/src/index.ts'\n`,
  );
  process.exit(1);
}

console.log(`Shared-package source guard: ${inspected} workspaces map "${PACKAGE}" to source.`);
