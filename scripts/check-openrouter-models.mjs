#!/usr/bin/env node
/**
 * Verifies every production model still exists on OpenRouter.
 *
 * Uses the public `/models` endpoint (no API key, no cost), so a model that
 * OpenRouter removes or renames fails loudly via the scheduled
 * `model-availability` workflow instead of silently breaking chats.
 *
 * Keep MODELS in sync with `endpoints.custom[].models.default` in
 * 1ma-lab/librechat.yaml and PRODUCTION_MODELS in
 * packages/api/src/endpoints/openai/models.smoke.spec.ts.
 */
const MODELS = [
  'openai/gpt-5.5',
  'openai/gpt-5.4-mini',
  'openai/gpt-5',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4.6',
  'deepseek/deepseek-chat',
  'google/gemini-2.5-pro',
];

const ENDPOINT = 'https://openrouter.ai/api/v1/models';

let response;
try {
  response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
} catch (error) {
  console.error(`Could not reach OpenRouter (${ENDPOINT}): ${error.message}`);
  process.exit(2);
}

if (!response.ok) {
  console.error(`OpenRouter /models returned HTTP ${response.status}`);
  process.exit(2);
}

const body = await response.json();
const available = new Set((body?.data ?? []).map((model) => model.id));
const missing = MODELS.filter((model) => !available.has(model));

if (missing.length > 0) {
  console.error(`❌ ${missing.length} production model(s) missing on OpenRouter:`);
  for (const model of missing) {
    console.error(`   - ${model}`);
  }
  console.error('Update 1ma-lab/librechat.yaml (and the smoke lists) to a current model id.');
  process.exit(1);
}

console.log(`✅ All ${MODELS.length} production models exist on OpenRouter.`);
