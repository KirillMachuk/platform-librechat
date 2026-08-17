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
/* Only real sources count. A `.DS_Store` that Finder drops while someone opens
 * the folder would otherwise read as "a different branch". */
const SOURCE_FILE = /\.([cm]?[jt]sx?|json|css|svg)$/;

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
      if (!entry.name.startsWith('.') && SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
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

/**
 * The packages this workspace declares. Judging a React package by the state of
 * a backend one blocks the run for a reason that workspace could not hit.
 */
function packagesFor(cwd) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    /* An empty result is a real answer — `data-provider` depends on none of them
     * and has nothing to be lied to about. Only an unreadable manifest falls back
     * to judging everything. */
    return Object.fromEntries(Object.entries(PACKAGES).filter(([name]) => declared.has(name)));
  } catch {
    return PACKAGES;
  }
}

function inspect(packages = packagesFor(process.cwd())) {
  const problems = [];
  let inspected = 0;

  for (const [name, [localDir, command]] of Object.entries(packages)) {
    const mine = path.join(REPO, localDir);
    if (!fs.existsSync(path.join(mine, 'src'))) {
      continue;
    }
    inspected++;
    const loaded = resolvePackageRoot(name);
    if (!loaded) {
      /* Every one of these packages points its `main` into `dist`, so failing to
       * resolve means it is unbuilt or uninstalled rather than merely missing. */
      problems.push(`${name}: cannot be resolved — it is not built or not installed\n      fix: ${command}`);
      continue;
    }

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
    if (newestMtime(path.join(loaded, 'src')) > newestMtime(dist)) {
      problems.push(`${name}: its build predates its source\n      fix: ${command}`);
    }
  }

  /** A check that inspected nothing passes everything — unless there was
   *  genuinely nothing in scope for this workspace. */
  if (inspected === 0 && Object.keys(packages).length > 0) {
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
    `about the same commit.\n\n` +
    `Rebuilding inside this checkout does NOT help while its node_modules is a\n` +
    `symlink to another checkout — the package symlink inside it still resolves\n` +
    `there. The cure is an install of this checkout's own (npm ci at its root,\n` +
    `then npm run build:packages), or re-pointing node_modules/<package> at this\n` +
    `checkout's copy.\n`
  );
}

/**
 * Stops the run by default; `WORKSPACE_BUILD_WARN_ONLY=1` downgrades it to a banner.
 *
 * The weakening is deliberately the opt-in half. A run is judged by its exit
 * code — that is how every automated caller here reads it — so a warning printed
 * mid-output is a warning that gets scrolled past while "13 passed" travels on
 * into a report. That is precisely the false green this guard exists to prevent,
 * so warning-only would have reproduced the disease it treats.
 *
 * Failing here does not interrupt valid work: it fires exactly when the results
 * would be worthless in both directions. Anyone who knowingly wants to run
 * against a borrowed checkout can say so, and then owns the caveat.
 */
module.exports = async function assertWorkspaceBuild(_globalConfig, projectConfig) {
  /* Jest hands over the project it is about to run. Leaning on `process.cwd()`
   * instead would disarm the guard whenever someone runs jest from the repo root
   * with an explicit --config, because the root manifest declares none of these
   * packages and nothing would be judged. */
  const workspace = projectConfig?.rootDir ?? process.cwd();
  /* Only the real runner is exempt. A bare `CI=1` gets set by devcontainers and
   * wrappers too — this repo's own pre-commit hook already works around that —
   * and disarming on it would leave exactly the machines this protects. */
  if (process.env.GITHUB_ACTIONS === 'true') {
    return;
  }
  const problems = inspect(packagesFor(workspace));
  if (problems.length === 0) {
    return;
  }
  const message = report(problems);
  if (process.env.WORKSPACE_BUILD_WARN_ONLY !== '1') {
    throw new Error(
      `${message}\nTo run anyway and own the caveat: WORKSPACE_BUILD_WARN_ONLY=1\n`,
    );
  }
  const rule = '='.repeat(72);
  process.stderr.write(`\n${rule}\n  RESULTS FROM THIS RUN ARE NOT TRUSTWORTHY${message}${rule}\n\n`);
};

module.exports.inspect = inspect;
module.exports.report = report;
