#!/usr/bin/env node
/**
 * Eval: does asking the gateway beat guessing from model names — and does it
 * ever make an answer worse?
 *
 * Unit tests prove the code does what it was written to do. They cannot say
 * whether the deployment got better, because "better" is measured against the
 * gateway catalogue, not against our expectations. So this scores the platform's
 * own resolution functions for every model a catalogue serves, twice: once with
 * nothing reported (the previous behaviour, name matching only) and once with the
 * catalogue published (the new behaviour).
 *
 * Ground truth is the catalogue itself. That is the point: the gateway is the
 * authority on what the gateway serves.
 *
 * Exits non-zero when any model's answer got worse, so this can gate a release.
 *
 *   node tools/model_capability_eval.mjs --save catalogue.json   # fetch + keep
 *   node tools/model_capability_eval.mjs --snapshot catalogue.json
 *   node tools/model_capability_eval.mjs --url http://gateway/v1 --key $KEY
 *   node tools/model_capability_eval.mjs --only a/one,b/two   # a chosen subset
 *
 * Requires the workspace packages to be built (npm run build:api).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  getModelMaxTokens,
  getModelMaxOutputTokens,
  publishModelLimits,
  clearModelLimits,
  extractModelCapabilities,
  getOpenAILLMConfig,
} = require(join(root, 'packages/api/dist/index.cjs'));
const { validateVisionModel, EModelEndpoint } = require(
  join(root, 'packages/data-provider/dist/index.js'),
);

const DEFAULT_URL = 'https://openrouter.ai/api/v1';
/** Deliberately larger than any real ceiling, so the clamp always has to decide. */
const HUGE_REQUEST = 10_000_000;

/**
 * Ground truth, read straight off the raw catalogue.
 *
 * Deliberately duplicates what `extractModelCapabilities` does instead of calling
 * it. An earlier revision of this script used the parser for both the answer and
 * the truth, which made it self-consistent and blind: inverting the parser's
 * vision test was scored as a 363-model *improvement*. A scorer that shares code
 * with the thing it scores cannot fail it.
 *
 * Keep this dumb and literal — its only job is to disagree when the parser is
 * wrong.
 */
function truthFor(entry) {
  const int = (value) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
  const windows = [int(entry.context_length), int(entry.top_provider?.context_length)].filter(
    (value) => value !== undefined,
  );
  const modalities = entry.architecture?.input_modalities;
  const params = entry.supported_parameters;
  return {
    contextTokens: windows.length ? Math.min(...windows) : undefined,
    maxOutputTokens: int(entry.top_provider?.max_completion_tokens),
    vision: Array.isArray(modalities) ? modalities.indexOf('image') !== -1 : undefined,
    tools: Array.isArray(params) ? params.indexOf('tools') !== -1 : undefined,
  };
}

/** Raw catalogue entries by id, so truth never passes through our parser. */
function rawById(payload) {
  const out = new Map();
  for (const entry of payload?.data ?? []) {
    if (entry && typeof entry.id === 'string' && entry.id !== '') {
      out.set(entry.id, entry);
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--only') args.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (flag === '--snapshot') args.snapshot = argv[++i];
    else if (flag === '--save') args.save = argv[++i];
    else if (flag === '--url') args.url = argv[++i];
    else if (flag === '--key') args.key = argv[++i];
    else if (flag === '--json') args.json = true;
    else {
      console.error(`unknown flag: ${flag}`);
      process.exit(2);
    }
  }
  return args;
}

async function loadCatalogue(args) {
  if (args.snapshot) {
    return JSON.parse(readFileSync(args.snapshot, 'utf8'));
  }
  const base = args.url ?? DEFAULT_URL;
  const headers = args.key ? { Authorization: `Bearer ${args.key}` } : {};
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) {
    throw new Error(`${base}/models -> HTTP ${res.status}`);
  }
  const payload = await res.json();
  if (args.save) {
    writeFileSync(args.save, JSON.stringify(payload));
  }
  return payload;
}

/**
 * The client's own rule for "does this model read images", from
 * `useFileHandling.modelReadsImages`. Restated here because that lives in a React
 * hook this script cannot import; the rule itself is pinned by the
 * `image capability warning` tests in `useFileHandling.test.ts`, so a change on
 * one side without the other fails there.
 */
function clientReadsImages(model, reported) {
  if (typeof reported === 'boolean') {
    return reported;
  }
  return validateVisionModel({ model });
}

/**
 * What the platform would actually do for one model, right now.
 *
 * `sentMaxTokens` runs the whole LLM-config build rather than reading a map: the
 * clamp only applies to models it recognises, so the map's opinion and the value
 * that reaches the provider are different questions. This asks the second one.
 */
function resolve(model, reportedVision) {
  let sentMaxTokens;
  try {
    const { llmConfig } = getOpenAILLMConfig({
      apiKey: 'eval',
      streaming: true,
      endpoint: '1ma',
      useOpenRouter: true,
      modelOptions: { model, max_tokens: HUGE_REQUEST },
    });
    sentMaxTokens =
      llmConfig.maxTokens ?? llmConfig.modelKwargs?.max_completion_tokens ?? undefined;
  } catch {
    sentMaxTokens = undefined;
  }
  return {
    context: getModelMaxTokens(model, EModelEndpoint.custom),
    ceiling: getModelMaxOutputTokens(model, EModelEndpoint.custom),
    sentMaxTokens,
    vision: clientReadsImages(model, reportedVision),
  };
}

/** Absolute distance from truth; an unknown answer is maximally wrong. */
const gap = (value, truth) => (typeof value === 'number' ? Math.abs(value - truth) : truth);

function scoreModel(model, truth, before, after) {
  const notes = [];
  let fixed = 0;
  let broke = 0;

  const judgeNumber = (label, key, truthValue) => {
    if (truthValue == null) {
      return null;
    }
    const b = before[key];
    const a = after[key];
    const wasExact = b === truthValue;
    const isExact = a === truthValue;
    if (isExact && !wasExact) {
      fixed++;
      notes.push(`${label}: ${b ?? '—'} → ${a} ✔`);
    } else if (!isExact && wasExact) {
      broke++;
      notes.push(`${label}: ${b} → ${a ?? '—'} ✗ REGRESSION`);
    } else if (!isExact && gap(a, truthValue) > gap(b, truthValue)) {
      broke++;
      notes.push(`${label}: ${b ?? '—'} → ${a ?? '—'} (truth ${truthValue}) ✗ REGRESSION`);
    }
    return { wasExact, isExact };
  };

  const context = judgeNumber('window', 'context', truth.contextTokens);
  const ceiling = judgeNumber('ceiling', 'ceiling', truth.maxOutputTokens);

  /**
   * Over-requesting is the failure the clamp exists to prevent: the provider
   * rejects the whole message. Sending less than allowed only shortens an answer.
   * So an over-request is counted as broken regardless of distance.
   */
  let overRequestBefore = false;
  let overRequestAfter = false;
  if (truth.maxOutputTokens != null) {
    overRequestBefore = (before.sentMaxTokens ?? 0) > truth.maxOutputTokens;
    overRequestAfter = (after.sentMaxTokens ?? 0) > truth.maxOutputTokens;
    if (overRequestAfter && !overRequestBefore) {
      broke++;
      notes.push(`sent ${after.sentMaxTokens} > cap ${truth.maxOutputTokens} ✗ REGRESSION`);
    } else if (overRequestBefore && !overRequestAfter) {
      fixed++;
      notes.push(`over-request stopped: ${before.sentMaxTokens} → ${after.sentMaxTokens} ✔`);
    }
  }

  let vision = null;
  if (typeof truth.vision === 'boolean') {
    const wasExact = before.vision === truth.vision;
    const isExact = after.vision === truth.vision;
    vision = { wasExact, isExact };
    if (isExact && !wasExact) {
      fixed++;
      notes.push(`vision: ${before.vision} → ${after.vision} ✔`);
    } else if (!isExact && wasExact) {
      broke++;
      notes.push(`vision: ${before.vision} → ${after.vision} ✗ REGRESSION`);
    }
  }

  return {
    model,
    context,
    ceiling,
    vision,
    overRequestBefore,
    overRequestAfter,
    fixed,
    broke,
    notes,
  };
}

const pct = (n, total) => (total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`);

function tally(rows, key) {
  const scored = rows.filter((row) => row[key] != null);
  return {
    total: scored.length,
    before: scored.filter((row) => row[key].wasExact).length,
    after: scored.filter((row) => row[key].isExact).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await loadCatalogue(args);
  /** The code under test. */
  const catalogue = extractModelCapabilities(payload);
  /** The scorer's own reading of the same bytes. */
  const raw = rawById(payload);
  const truth = new Map([...raw].map(([id, entry]) => [id, truthFor(entry)]));

  /**
   * The parser dropping or inventing models is itself a defect, and one the
   * per-model scoring below cannot see — it only walks models both sides know.
   */
  const parserMisses = [...raw.keys()].filter((id) => catalogue[id] == null);
  const parserInvents = Object.keys(catalogue).filter((id) => !raw.has(id));

  let models = [...raw.keys()];
  if (args.only?.length) {
    const missing = args.only.filter((model) => !raw.has(model));
    if (missing.length) {
      console.error(`not served by this gateway: ${missing.join(', ')}`);
    }
    models = args.only.filter((model) => raw.has(model));
  }
  if (models.length === 0) {
    console.error('catalogue produced no models — nothing to evaluate');
    process.exit(2);
  }

  /** Before: nothing reported, so every answer falls back to name matching. */
  clearModelLimits();
  const before = new Map(models.map((model) => [model, resolve(model, undefined)]));

  /** After: the catalogue is published, exactly as the endpoints config does it. */
  publishModelLimits(catalogue);
  const after = new Map(models.map((model) => [model, resolve(model, catalogue[model]?.vision)]));

  const rows = models.map((model) =>
    scoreModel(model, truth.get(model), before.get(model), after.get(model)),
  );

  const window = tally(rows, 'context');
  const ceiling = tally(rows, 'ceiling');
  const vision = tally(rows, 'vision');
  const overBefore = rows.filter((row) => row.overRequestBefore).length;
  const overAfter = rows.filter((row) => row.overRequestAfter).length;
  const regressions = rows.filter((row) => row.broke > 0);
  const improved = rows.filter((row) => row.fixed > 0 && row.broke === 0);

  if (args.json) {
    console.log(JSON.stringify({ window, ceiling, vision, overBefore, overAfter, rows }, null, 1));
  } else {
    console.log(`\nmodels evaluated: ${models.length}\n`);
    const line = (label, t) =>
      console.log(
        `  ${label.padEnd(22)} ${String(t.before).padStart(4)}/${t.total} (${pct(t.before, t.total).padStart(6)})  →  ` +
          `${String(t.after).padStart(4)}/${t.total} (${pct(t.after, t.total).padStart(6)})`,
      );
    console.log('  correct answers          before                after');
    line('context window', window);
    line('output ceiling', ceiling);
    line('reads images', vision);
    console.log(
      `  ${'over-requests sent'.padEnd(22)} ${String(overBefore).padStart(4)}/${rows.length}` +
        `                 → ${String(overAfter).padStart(4)}/${rows.length}   (lower is better)`,
    );
    console.log(`\n  models improved: ${improved.length}`);
    console.log(`  models regressed: ${regressions.length}`);
    console.log(
      `  parser: missed ${parserMisses.length}, invented ${parserInvents.length} (both must be 0)`,
    );

    const detail = args.only?.length ? rows.filter((row) => row.notes.length) : regressions;
    for (const row of detail) {
      console.log(`\n  ${row.model}`);
      for (const note of row.notes) {
        console.log(`    ${note}`);
      }
    }
  }

  const problems = [];
  if (regressions.length > 0) {
    problems.push(`${regressions.length} model(s) got worse`);
  }
  if (parserMisses.length > 0) {
    problems.push(`parser dropped ${parserMisses.length} model(s), e.g. ${parserMisses[0]}`);
  }
  if (parserInvents.length > 0) {
    problems.push(`parser invented ${parserInvents.length} model(s), e.g. ${parserInvents[0]}`);
  }
  if (problems.length > 0) {
    console.error(`\nFAIL: ${problems.join('; ')}.`);
    process.exit(1);
  }
  console.log('\nOK: no model got a worse answer.\n');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
