const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

const createAuditOnFinish = require('./auditOnFinish');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function buildReq(overrides = {}) {
  return { user: { _id: 'u1', email: 'u@x.io', role: 'ADMIN', tenantId: 't1' }, ...overrides };
}

describe('createAuditOnFinish', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('merges actor, tenant, outcome and request context with the resolved fields', () => {
    const mw = createAuditOnFinish(() => ({ action: 'agent.invoke', targetType: 'agent' }));
    const res = buildRes(200);
    const next = jest.fn();

    mw(buildReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith({
      actorId: 'u1',
      actorEmail: 'u@x.io',
      actorRole: 'ADMIN',
      tenantId: 't1',
      outcome: 'success',
      action: 'agent.invoke',
      targetType: 'agent',
      ip: '9.9.9.9',
      userAgent: 'jest',
    });
  });

  it('skips when the response failed (status >= 400)', () => {
    const mw = createAuditOnFinish(() => ({ action: 'agent.invoke' }));
    const res = buildRes(500);
    mw(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('skips when resolve returns null', () => {
    const resolve = jest.fn().mockReturnValue(null);
    const mw = createAuditOnFinish(resolve);
    const res = buildRes(200);
    mw(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('lets the resolver override outcome when provided', () => {
    const mw = createAuditOnFinish(() => ({ action: 'auth.login_failed', outcome: 'failure' }));
    const res = buildRes(200);
    mw(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit.mock.calls[0][0].outcome).toBe('failure');
  });
});
