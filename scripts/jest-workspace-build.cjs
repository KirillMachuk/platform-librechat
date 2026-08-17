/**
 * Refuses to run a suite against a workspace package that is not this checkout's.
 *
 * The workspace packages are consumed through their gitignored `dist`. When a git
 * worktree borrows `node_modules` from another checkout — the usual way to avoid
 * a multi-gigabyte install per worktree — every `require('librechat-data-provider')`
 * resolves into *that* checkout, and therefore into whatever branch it is sitting
 * on. The tests then exercise someone else's code while reporting on yours.
 *
 * Measured on 2026-08-17: a worktree's tests loaded `packages/data-provider` from a
 * checkout parked on an unrelated branch where `AutoModes` did not exist yet.
 * `resolveAutoMode` threw in three tests while the same commit was green in CI,
 * which builds its own packages. The red half was the harmless half — a test whose
 * subject tolerates a falsy import passes having checked nothing, and says nothing.
 *
 * Two rules, both cheap, both local-only (CI builds its own packages every run):
 *   1. a borrowed package's `src` must be identical to this checkout's copy;
 *   2. its `dist` must not predate its `src`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const REPO = path.resolve(__dirname, '..');

/** Package name -> its directory in this repo, and how to rebuild it. */
const PACKAGES = {
  'librechat-data-provider': ['packages/data-provider', 'npm run build:data-provider'],
  '@librechat/data-schemas': ['packages/data-schemas', 'npm run build:data-schemas'],
  '@librechat/api': ['packages/api', 'npm run build:api'],
  '@librechat/client': ['packages/client', 'npm run build:client-package'],
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'coverage']);

function walk(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }
      files.push(full);
    }
  }
  return files;
}

/** Content fingerprint of a source tree, independent of file timestamps. */
function fingerprint(dir) {
  const hash = createHash('sha1');
  for (const file of walk(dir).sort()) {
    hash.update(path.relative(dir, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function newestMtime(dir) {
  let newest = 0;
  for (const file of walk(dir)) {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs > newest) {
      newest = mtimeMs;
    }
  }
  return newest;
}

/** The directory of the package a test would actually load, or null. */
function resolvePackageRoot(name) {
  let entry;
  try {
    entry = require.resolve(name, { paths: [process.cwd(), REPO] });
  } catch {
    return null;
  }
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function inspect() {
  const problems = [];
  let inspected = 0;

  for (const [name, [localDir, command]] of Object.entries(PACKAGES)) {
    const mine = path.join(REPO, localDir);
    const loaded = resolvePackageRoot(name);
    if (!loaded || !fs.existsSync(path.join(mine, 'src'))) {
      continue;
    }
    inspected++;

    if (path.resolve(loaded) !== path.resolve(mine)) {
      const loadedSrc = path.join(loaded, 'src');
      if (!fs.existsSync(loadedSrc) || fingerprint(loadedSrc) !== fingerprint(path.join(mine, 'src'))) {
        problems.push(
          `${name}: tests would load it from\n      ${loaded}\n` +
            `    whose source differs from this checkout's. That copy belongs to another\n` +
            `    branch, so the suite would report on code that is not yours.`,
        );
        continue;
      }
    }

    const dist = path.join(loaded, 'dist');
    if (!fs.existsSync(dist)) {
      problems.push(`${name}: has no build at all\n      fix: ${command}`);
      continue;
    }
    if (newestMtime(path.join(loaded, 'src')) > newestMtime(dist)) {
      problems.push(`${name}: its build predates its source\n      fix: ${command}`);
    }
  }

  /** A check that inspected nothing passes everything. */
  if (inspected === 0) {
    problems.push(
      'resolved none of the workspace packages — this check is not looking where it thinks it is',
    );
  }
  return problems;
}

function report(problems) {
  return (
    `\nThe workspace packages under test are not this checkout's:\n\n  - ${problems.join(
      '\n\n  - ',
    )}\n\nCI builds its own packages every run, so this machine and CI would disagree\n` +
    `about the same commit. Give this checkout its own build, or point it at one\n` +
    `made from the same source.\n`
  );
}

/**
 * Warns by default and fails only under `STRICT_WORKSPACE_BUILD=1`.
 *
 * Borrowing `node_modules` between checkouts is the established way to avoid a
 * multi-gigabyte install per worktree here, and several worktrees rely on it
 * right now. Turning that into a hard stop is a decision for whoever owns those
 * worktrees, not a side effect of this file — so the default is a banner nobody
 * can miss in the scrollback, and the strict mode is there for CI-like runs and
 * for anyone who wants the stop.
 */
module.exports = async function assertWorkspaceBuild() {
  if (process.env.CI) {
    return;
  }
  const problems = inspect();
  if (problems.length === 0) {
    return;
  }
  const message = report(problems);
  if (process.env.STRICT_WORKSPACE_BUILD === '1') {
    throw new Error(message);
  }
  const rule = '='.repeat(72);
  process.stderr.write(`\n${rule}\n  RESULTS FROM THIS RUN ARE NOT TRUSTWORTHY${message}${rule}\n\n`);
};

module.exports.inspect = inspect;
module.exports.report = report;
