/**
 * Anti-false-green guards over the CI wiring itself (ADOPTION Wave 1, А7).
 *
 * Three checks, each closing a class of silent-green failure this fork has
 * either hit or inherited the risk of (dsh/openclaw/cfos lessons):
 *
 * 1. `passWithNoTests` is banned everywhere. Today it appears nowhere; a
 *    future `--passWithNoTests` would let a suite whose tests stopped being
 *    FOUND go green with zero tests executed. Jest's default (fail on zero)
 *    is the protection — this check keeps it from being switched off.
 *
 * 2. Every `npm run <script>` a workflow invokes must exist in the
 *    package.json of the directory it runs in (working-directory / `cd X &&`).
 *    Otherwise renaming an npm script silently turns a CI gate into a
 *    "missing script" failure at best — or, combined with `|| true`-style
 *    step plumbing, into a no-op.
 *
 * 3. Aggregator discipline: the four gating workflows each carry an
 *    `aggregate` job (if: always(), fails on failure/cancelled/skipped
 *    needs — GitHub treats a SKIPPED required check as passed!), and its
 *    `needs` list must equal the workflow's full job list. A newly added
 *    job that is not added to `needs` silently escapes the aggregate — this
 *    check is what makes the aggregator trustworthy.
 *
 * Dependency-free by design: the repo-guards CI job runs without npm install,
 * so no yaml lib — targeted line parsing over OUR workflow corpus, guarded by
 * self-check fixtures that copy the corpus shapes and by a liveness floor
 * (the extractor refusing to find at least MIN_NPM_RUN_REFS references fails
 * the run — a matcher that matches nothing is itself a defect).
 *
 * Run with `npm run check:workflows`. Exit 0 clean, 1 violations, 2 broken
 * self-check.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF_DIR = '.github/workflows';

/** Workflows that gate merges and must carry a complete aggregate job. */
const REQUIRED_AGGREGATE = [
  'ui-guards.yml',
  'backend-review.yml',
  'frontend-review.yml',
  'playwright-mock.yml',
];

/** Liveness floor for the npm-run extractor (corpus has ~25 today). */
const MIN_NPM_RUN_REFS = 15;

// ---------------------------------------------------------------------------
// Targeted extraction
// ---------------------------------------------------------------------------

export function extractJobs(yamlText) {
  const jobs = [];
  let inJobs = false;
  for (const line of yamlText.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs && /^[A-Za-z]/.test(line)) {
      inJobs = false;
    }
    const m = inJobs && line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      jobs.push(m[1]);
    }
  }
  return jobs;
}

export function extractAggregateNeeds(yamlText) {
  // The aggregate jobs are WRITTEN with an inline list on purpose, so the
  // dependency-free parser stays trivial. A block-style needs list in an
  // aggregate job reads as "missing" and fails loudly, which is acceptable.
  const m = yamlText.match(/^ {2}aggregate:\s*$[\s\S]*?^ {4}needs:\s*\[([^\]]*)\]/m);
  if (!m) {
    return null;
  }
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Yields { script, dir } for every `npm run X` in a workflow file.
 * dir resolution: same-line `cd X &&` wins; else a `working-directory:` line
 * within the same step (nearest step start above); else repo root.
 */
export function extractNpmRuns(yamlText) {
  const lines = yamlText.split('\n');
  const stepStartAbove = [];
  let current = -1;
  lines.forEach((line, i) => {
    if (/^\s*- /.test(line)) {
      current = i;
    }
    stepStartAbove[i] = current;
  });
  const wdByStep = new Map();
  lines.forEach((line, i) => {
    const wd = line.match(/^\s*working-directory:\s*(\S+)\s*$/);
    if (wd) {
      wdByStep.set(stepStartAbove[i], wd[1].replace(/^\.\//, ''));
    }
  });
  const out = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/npm run ([A-Za-z0-9:._-]+)/g)) {
      const cd = line.match(/cd ([A-Za-z0-9/._-]+)\s*&&.*npm run/);
      const dir = cd ? cd[1] : (wdByStep.get(stepStartAbove[i]) ?? '.');
      out.push({ script: m[1], dir });
    }
  });
  return out;
}

export function scriptExists(root, dir, script, readFile = readFileSync) {
  const pkgPath = join(root, dir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFile(pkgPath, 'utf8'));
  } catch {
    return { ok: false, reason: `${dir}/package.json unreadable` };
  }
  if (pkg.scripts && Object.hasOwn(pkg.scripts, script)) {
    return { ok: true };
  }
  return { ok: false, reason: `"${script}" not in ${dir}/package.json scripts` };
}

// ---------------------------------------------------------------------------
// The three checks (pure, fixture-testable)
// ---------------------------------------------------------------------------

export function checkPassWithNoTests(files) {
  return files
    .filter(({ text }) => /passWithNoTests/.test(text))
    .map(({ path }) => ({ check: 'passWithNoTests', path, msg: 'passWithNoTests found — a suite whose tests stop being found would go green' }));
}

export function checkNpmScripts(workflows, root, readFile = readFileSync) {
  const violations = [];
  let refs = 0;
  for (const { path, text } of workflows) {
    for (const { script, dir } of extractNpmRuns(text)) {
      refs += 1;
      const res = scriptExists(root, dir, script, readFile);
      if (!res.ok) {
        violations.push({ check: 'npm-script', path, msg: `npm run ${script} (dir: ${dir}) — ${res.reason}` });
      }
    }
  }
  return { violations, refs };
}

export function checkAggregates(workflows) {
  const violations = [];
  const byName = new Map(workflows.map((w) => [w.name, w]));
  for (const name of REQUIRED_AGGREGATE) {
    const wf = byName.get(name);
    if (!wf) {
      violations.push({ check: 'aggregate', path: name, msg: 'gating workflow file missing' });
      continue;
    }
    const jobs = extractJobs(wf.text).filter((j) => j !== 'aggregate');
    const needs = extractAggregateNeeds(wf.text);
    if (needs == null) {
      violations.push({ check: 'aggregate', path: name, msg: 'no aggregate job with an inline needs list' });
      continue;
    }
    const missing = jobs.filter((j) => !needs.includes(j));
    const stale = needs.filter((n) => !jobs.includes(n));
    if (missing.length) {
      violations.push({ check: 'aggregate', path: name, msg: `jobs escape the aggregate: ${missing.join(', ')}` });
    }
    if (stale.length) {
      violations.push({ check: 'aggregate', path: name, msg: `aggregate needs unknown jobs: ${stale.join(', ')}` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Self-check: every check must catch its founding case.
// ---------------------------------------------------------------------------

function selfCheck() {
  const failures = [];
  const okAgg = `jobs:\n  a:\n    x: 1\n  b:\n    x: 1\n  aggregate:\n    if: always()\n    needs: [a, b]\n`;
  const holeAgg = `jobs:\n  a:\n    x: 1\n  b:\n    x: 1\n  aggregate:\n    if: always()\n    needs: [a]\n`;
  if (checkAggregates([{ name: 'ui-guards.yml', text: holeAgg }, { name: 'backend-review.yml', text: okAgg }, { name: 'frontend-review.yml', text: okAgg }, { name: 'playwright-mock.yml', text: okAgg }]).filter((v) => v.path === 'ui-guards.yml').length !== 1) {
    failures.push('aggregate: escaped job not caught');
  }
  if (checkAggregates([{ name: 'ui-guards.yml', text: okAgg }, { name: 'backend-review.yml', text: okAgg }, { name: 'frontend-review.yml', text: okAgg }, { name: 'playwright-mock.yml', text: okAgg }]).length !== 0) {
    failures.push('aggregate: clean fixture flagged');
  }
  if (checkPassWithNoTests([{ path: 'f', text: 'testMatch: x\npassWithNoTests: true' }]).length !== 1) {
    failures.push('passWithNoTests not caught');
  }
  // npm-run resolution fixtures copy the real corpus shapes:
  const wfFixture = [
    '      - name: a',
    '        run: npm run present-root',
    '      - name: b',
    '        run: npm run present-client',
    '        working-directory: client',
    '      - name: c',
    '        run: cd api && npm run missing-api -- --flag',
    '      - name: d',
    '        working-directory: ./packages/data-provider',
    '        run: |',
    '          output=$(npm run present-dp)',
  ].join('\n');
  const fakePkgs = new Map([
    [join('/fake', '.', 'package.json'), { scripts: { 'present-root': 'x' } }],
    [join('/fake', 'client', 'package.json'), { scripts: { 'present-client': 'x' } }],
    [join('/fake', 'api', 'package.json'), { scripts: {} }],
    [join('/fake', 'packages/data-provider', 'package.json'), { scripts: { 'present-dp': 'x' } }],
  ]);
  const fakeRead = (p) => {
    if (!fakePkgs.has(p)) {
      throw new Error('missing ' + p);
    }
    return JSON.stringify(fakePkgs.get(p));
  };
  const { violations, refs } = checkNpmScripts([{ path: 'wf', text: wfFixture }], '/fake', fakeRead);
  if (refs !== 4) {
    failures.push(`npm-run extractor found ${refs}/4 fixture refs`);
  }
  if (violations.length !== 1 || !violations[0].msg.includes('missing-api')) {
    failures.push('npm-run: the missing script was not the one caught');
  }
  return failures;
}

// ---------------------------------------------------------------------------

function main() {
  const failures = selfCheck();
  if (failures.length) {
    console.error('[check-workflows] SELF-CHECK FAILED:');
    for (const f of failures) console.error('  ' + f);
    return 2;
  }

  const wfFiles = readdirSync(join(ROOT, WF_DIR))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ name: f, path: `${WF_DIR}/${f}`, text: readFileSync(join(ROOT, WF_DIR, f), 'utf8') }));

  const banScope = [...wfFiles];
  for (const p of [
    'package.json', 'api/package.json', 'client/package.json',
    'api/jest.config.js', 'client/jest.config.cjs', 'config/jest.config.js',
    'packages/api/jest.config.mjs', 'packages/api/package.json',
    'packages/client/jest.config.js', 'packages/client/package.json',
    'packages/data-provider/jest.config.js', 'packages/data-provider/package.json',
    'packages/data-schemas/jest.config.mjs', 'packages/data-schemas/package.json',
  ]) {
    if (existsSync(join(ROOT, p))) {
      banScope.push({ name: p, path: p, text: readFileSync(join(ROOT, p), 'utf8') });
    }
  }

  const violations = [];
  violations.push(...checkPassWithNoTests(banScope));
  const npm = checkNpmScripts(wfFiles, ROOT);
  violations.push(...npm.violations);
  if (npm.refs < MIN_NPM_RUN_REFS) {
    violations.push({ check: 'liveness', path: WF_DIR, msg: `extractor found only ${npm.refs} npm-run refs (< ${MIN_NPM_RUN_REFS}) — matcher gone blind` });
  }
  violations.push(...checkAggregates(wfFiles));

  if (violations.length) {
    console.error('[check-workflows] violations:');
    for (const v of violations) {
      console.error(`  [${v.check}] ${v.path}: ${v.msg}`);
    }
    return 1;
  }
  console.log(`[check-workflows] OK: ${wfFiles.length} workflows, ${npm.refs} npm-run refs resolved, aggregates complete, passWithNoTests absent.`);
  return 0;
}

process.exit(main());
