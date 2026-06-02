const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditPermission = require('./auditPermission');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function buildReq(overrides = {}) {
  return {
    method: 'POST',
    params: {},
    body: {},
    user: { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' },
    ...overrides,
  };
}

describe('auditPermission', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records permission.grant on POST with principal + capability', () => {
    const res = buildRes(200);
    auditPermission(
      buildReq({ body: { principalType: 'user', principalId: 'p1', capability: 'manage:users' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permission.grant',
        targetType: 'grant',
        targetId: 'p1',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      principalType: 'user',
      capability: 'manage:users',
    });
  });

  it('records permission.revoke on DELETE, decoding the capability param', () => {
    const res = buildRes(200);
    auditPermission(
      buildReq({
        method: 'DELETE',
        params: { principalType: 'role', principalId: 'ADMIN', capability: 'manage%3Aconfigs' },
      }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'permission.revoke', targetId: 'ADMIN' }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      principalType: 'role',
      capability: 'manage:configs',
    });
  });

  it('ignores reads (GET)', () => {
    const res = buildRes(200);
    const next = jest.fn();
    auditPermission(buildReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('does not record a failed write (status >= 400)', () => {
    const res = buildRes(400);
    auditPermission(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
