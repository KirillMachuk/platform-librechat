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

describe('auditModelCatalogueChange', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  /** Disabling a model stops employees selecting it, so the list itself is the
   *  change worth keeping — "who narrowed the line-up to these, and when". */
  it('records the applied list with its count', () => {
    const req = buildReq({
      body: { endpoint: '1ma', models: ['anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-pro'] },
    });
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
      count: 2,
      models: ['anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-pro'],
    });
  });

  it('does not record a rejected write (status >= 400)', () => {
    const res = buildRes(400);
    auditModelCatalogueChange(
      buildReq({ body: { endpoint: '1ma', models: ['a/one'] } }),
      res,
      jest.fn(),
    );
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

  /** A malformed body never reaches the write, so there is nothing to record —
   *  an entry here would claim a change that did not happen. */
  it('skips a PUT whose body is not a model list', () => {
    for (const body of [{}, { endpoint: '1ma' }, { models: ['a/one'] }, { endpoint: 1, models: [] }]) {
      mockRecordAudit.mockClear();
      const res = buildRes(200);
      auditModelCatalogueChange(buildReq({ body }), res, jest.fn());
      res.emit('finish');

      expect(mockRecordAudit).not.toHaveBeenCalled();
    }
  });

  it('keeps only string entries out of a mixed list', () => {
    const res = buildRes(200);
    auditModelCatalogueChange(
      buildReq({ body: { endpoint: '1ma', models: ['a/one', 42, null, 'a/two'] } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      count: 4,
      models: ['a/one', 'a/two'],
    });
  });
});
