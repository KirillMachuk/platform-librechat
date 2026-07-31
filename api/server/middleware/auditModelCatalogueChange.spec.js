const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditModelCatalogueChange = require('./auditModelCatalogueChange');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.writableEnded = true;
  return res;
}

function buildReq(overrides = {}) {
  return {
    method: 'PUT',
    params: {},
    body: {},
    user: { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' },
    ...overrides,
  };
}

/** What the handler leaves behind once a write has actually gone through. */
const applied = (overrides = {}) => ({
  endpoint: '1ma',
  model: 'deepseek/deepseek-v4-pro',
  enabled: true,
  models: ['anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-pro'],
  ...overrides,
});

describe('auditModelCatalogueChange', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  /** Disabling a model stops employees selecting it, so the resulting list is the
   *  change worth keeping — "who narrowed the line-up to these, and when". */
  it('records what was applied, with the model that moved', () => {
    const req = buildReq({ modelCatalogueChange: applied() });
    const res = buildRes(200);
    const next = jest.fn();

    auditModelCatalogueChange(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled(); // not until finish

    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'models.set_enabled',
        targetType: 'endpoint',
        targetId: '1ma',
        actorEmail: 'admin@x.io',
        outcome: 'success',
        ip: '1.2.3.4',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      model: 'deepseek/deepseek-v4-pro',
      enabled: true,
      count: 2,
      models: ['anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-pro'],
    });
  });

  it('does not record a rejected write (status >= 400)', () => {
    const res = buildRes(400);
    auditModelCatalogueChange(buildReq({ modelCatalogueChange: applied() }), res, jest.fn());
    res.emit('finish');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('ignores reads entirely', () => {
    const res = buildRes(200);
    const next = jest.fn();

    auditModelCatalogueChange(buildReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  /**
   * Read from what the handler wrote, never from the request body: a body states an
   * intent, and an intent can be a no-op (enable what is already enabled) that
   * answers 200 without changing anything. An entry for it would make the journal
   * claim a change that never happened.
   */
  it('records nothing when the request changed nothing', () => {
    for (const req of [
      buildReq(),
      buildReq({ body: { endpoint: '1ma', model: 'a/one', enabled: true } }),
      buildReq({ body: { endpoint: '1ma', models: ['a/one'] } }),
    ]) {
      mockRecordAudit.mockClear();
      const res = buildRes(200);
      auditModelCatalogueChange(req, res, jest.fn());
      res.emit('finish');

      expect(mockRecordAudit).not.toHaveBeenCalled();
    }
  });

  it('records a switch-off as such', () => {
    const res = buildRes(200);
    auditModelCatalogueChange(
      buildReq({
        modelCatalogueChange: applied({
          model: 'openai/gpt-5.6-sol',
          enabled: false,
          models: ['anthropic/claude-sonnet-5'],
        }),
      }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      model: 'openai/gpt-5.6-sol',
      enabled: false,
      count: 1,
      models: ['anthropic/claude-sonnet-5'],
    });
  });
});
