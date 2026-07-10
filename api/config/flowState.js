/**
 * Assesses whether MCP OAuth flow state is stored durably (Redis) or in-memory,
 * and returns an operator warning when it is ephemeral.
 *
 * In-memory flow state is lost on server restart/redeploy and is not shared
 * across containers, so an in-flight OAuth authorization can be dropped. The
 * callback path already degrades gracefully in that case (see
 * `FlowStateManager.completeFlow`), but operators get no proactive signal —
 * this surfaces one at flow-manager creation.
 *
 * @param {Object} params
 * @param {boolean} params.usesRedis - Whether the cache backend is Redis.
 * @param {string[]} [params.forcedInMemoryNamespaces] - Namespaces pinned to in-memory even under Redis.
 * @param {string} params.flowsNamespace - The cache namespace used for flow state.
 * @returns {{ ephemeral: boolean, warning?: string }}
 */
function assessFlowStatePersistence({ usesRedis, forcedInMemoryNamespaces, flowsNamespace }) {
  const forcedInMemory =
    Array.isArray(forcedInMemoryNamespaces) && forcedInMemoryNamespaces.includes(flowsNamespace);
  const ephemeral = !usesRedis || forcedInMemory;
  if (!ephemeral) {
    return { ephemeral: false };
  }
  return {
    ephemeral: true,
    warning:
      '[MCP OAuth] Flow state is stored in-memory (Redis is disabled). Unfinished MCP OAuth ' +
      'authorizations are lost on server restart/redeploy and are not shared across containers, ' +
      'so users may need to restart an in-progress authorization. Enable Redis (USE_REDIS=true) ' +
      'for durable OAuth flow state.',
  };
}

module.exports = { assessFlowStatePersistence };
