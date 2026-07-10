const { normalizeEndpointName } = require('librechat-data-provider');

/**
 * Preset keys that identify or route the preset. Never stripped, even if an
 * endpoint's `dropParams` mistakenly lists one — `dropParams` targets model
 * parameters (temperature, stop, web_search, …), not preset structure.
 */
const PROTECTED_PRESET_KEYS = new Set([
  'presetId',
  'title',
  'defaultPreset',
  'order',
  'endpoint',
  'endpointType',
  'model',
  'agent_id',
  'assistant_id',
  'spec',
  'iconURL',
  'modelLabel',
  'chatGptLabel',
]);

/**
 * Resolves the `dropParams` configured for a custom endpoint, matched by
 * normalized name against the resolved app config.
 * @param {object} [appConfig] - Resolved app config (req.config).
 * @param {string} [endpoint] - The preset's endpoint.
 * @returns {string[]}
 */
function resolveEndpointDropParams(appConfig, endpoint) {
  const customEndpoints = appConfig?.endpoints?.custom;
  if (!Array.isArray(customEndpoints) || !endpoint) {
    return [];
  }
  const target = normalizeEndpointName(endpoint);
  const match = customEndpoints.find((ep) => ep?.name && normalizeEndpointName(ep.name) === target);
  return Array.isArray(match?.dropParams) ? match.dropParams : [];
}

/**
 * Returns a copy of the preset update with the endpoint's dropped parameters
 * removed, so a saved preset never persists settings the backend strips at
 * request time. Protected structural keys are preserved. Returns the input
 * unchanged when nothing is dropped.
 * @param {Record<string, unknown>} update - The preset body.
 * @param {object} [appConfig] - Resolved app config (req.config).
 * @returns {Record<string, unknown>}
 */
function stripDroppedPresetParams(update, appConfig) {
  if (update == null || typeof update !== 'object') {
    return update;
  }
  const dropParams = resolveEndpointDropParams(appConfig, update.endpoint);
  if (dropParams.length === 0) {
    return update;
  }
  const result = { ...update };
  for (const key of dropParams) {
    if (!PROTECTED_PRESET_KEYS.has(key)) {
      delete result[key];
    }
  }
  return result;
}

module.exports = {
  stripDroppedPresetParams,
  resolveEndpointDropParams,
  PROTECTED_PRESET_KEYS,
};
