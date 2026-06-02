const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditApiKey = require('./auditApiKey');

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
    user: { _id: 'user1', email: 'u@x.io', role: 'USER' },
    ...overrides,
  };
}

describe('auditApiKey', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records apikey.create on a successful POST, with the key name', () => {
    const res = buildRes(201);
    const next = jest.fn();
    auditApiKey(buildReq({ method: 'POST', body: { name: 'CI key' } }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'apikey.create',
        targetType: 'apikey',
        actorEmail: 'u@x.io',
        outcome: 'success',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({ name: 'CI key' });
  });

  it('records apikey.revoke on a successful DELETE with the key id', () => {
    const res = buildRes(200);
    auditApiKey(buildReq({ method: 'DELETE', params: { id: 'key-9' } }), res, jest.fn());
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apikey.revoke', targetId: 'key-9' }),
    );
  });

  it('does not record a failed write (status >= 400)', () => {
    const res = buildRes(403);
    auditApiKey(buildReq({ method: 'POST' }), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('ignores reads (GET)', () => {
    const res = buildRes(200);
    const next = jest.fn();
    auditApiKey(buildReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
