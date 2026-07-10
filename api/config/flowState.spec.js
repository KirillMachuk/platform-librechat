const { assessFlowStatePersistence } = require('./flowState');

const FLOWS = 'flows';

describe('assessFlowStatePersistence', () => {
  it('flags ephemeral flow state when Redis is disabled', () => {
    const result = assessFlowStatePersistence({
      usesRedis: false,
      forcedInMemoryNamespaces: [],
      flowsNamespace: FLOWS,
    });
    expect(result.ephemeral).toBe(true);
    expect(result.warning).toMatch(/in-memory/i);
    expect(result.warning).toMatch(/USE_REDIS/);
  });

  it('flags ephemeral flow state when the flows namespace is forced in-memory under Redis', () => {
    const result = assessFlowStatePersistence({
      usesRedis: true,
      forcedInMemoryNamespaces: [FLOWS],
      flowsNamespace: FLOWS,
    });
    expect(result.ephemeral).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('reports durable (no warning) when Redis is enabled and flows are not forced in-memory', () => {
    const result = assessFlowStatePersistence({
      usesRedis: true,
      forcedInMemoryNamespaces: ['some-other-namespace'],
      flowsNamespace: FLOWS,
    });
    expect(result.ephemeral).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('reports durable when Redis is enabled and no namespaces are forced in-memory', () => {
    const result = assessFlowStatePersistence({
      usesRedis: true,
      forcedInMemoryNamespaces: undefined,
      flowsNamespace: FLOWS,
    });
    expect(result.ephemeral).toBe(false);
  });
});
