const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditConfigChange = require('./auditConfigChange');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function buildReq(overrides = {}) {
  return {
    method: 'PUT',
    params: { principalType: 'user', principalId: 'p1' },
    user: { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' },
    ...overrides,
  };
}

describe('auditConfigChange', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records admin.config_change after a successful write', () => {
    const req = buildReq();
    const res = buildRes(200);
    const next = jest.fn();

    auditConfigChange(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled(); // not until finish

    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.config_change',
        targetType: 'config',
        targetId: 'p1',
        actorEmail: 'admin@x.io',
        outcome: 'success',
        ip: '1.2.3.4',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      method: 'PUT',
      principalType: 'user',
    });
  });

  it('does not record a failed write (status >= 400)', () => {
    const res = buildRes(403);
    auditConfigChange(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('ignores read (GET) requests entirely', () => {
    const res = buildRes(200);
    const next = jest.fn();
    auditConfigChange(buildReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('records DELETE and PATCH writes too', () => {
    for (const method of ['DELETE', 'PATCH']) {
      mockRecordAudit.mockClear();
      const res = buildRes(200);
      auditConfigChange(buildReq({ method }), res, jest.fn());
      res.emit('finish');
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit.mock.calls[0][0].metadata.method).toBe(method);
    }
  });
});
