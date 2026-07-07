const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditUserManagement = require('./auditUserManagement');

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

describe('auditUserManagement', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records user.create on POST with the assigned role', () => {
    const res = buildRes(201);
    auditUserManagement(
      buildReq({ body: { email: 'new@x.io', password: 'secret', role: 'ADMIN' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.create', targetType: 'user' }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({ role: 'ADMIN' });
  });

  it('never records the password in the audit payload', () => {
    const res = buildRes(201);
    auditUserManagement(
      buildReq({ body: { email: 'new@x.io', password: 'secret', role: 'USER' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(JSON.stringify(mockRecordAudit.mock.calls[0][0])).not.toContain('secret');
  });

  it('records user.update with the target id and the new role', () => {
    const res = buildRes(200);
    auditUserManagement(
      buildReq({ method: 'PATCH', params: { id: 'u42' }, body: { role: 'ADMIN' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.update', targetType: 'user', targetId: 'u42' }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({ role: 'ADMIN' });
  });

  it('records user.delete with the target id', () => {
    const res = buildRes(200);
    auditUserManagement(
      buildReq({ method: 'DELETE', params: { id: 'u42' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.delete', targetType: 'user', targetId: 'u42' }),
    );
  });

  it('does not record a failed write (status >= 400)', () => {
    const res = buildRes(403);
    auditUserManagement(
      buildReq({ method: 'PATCH', params: { id: 'u42' }, body: { role: 'ADMIN' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
