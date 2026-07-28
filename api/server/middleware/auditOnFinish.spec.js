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
  res.writableEnded = false;
  return res;
}

/** A response that completed normally: Express emits both events, in this order. */
function settle(res) {
  res.writableEnded = true;
  res.emit('finish');
  res.emit('close');
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
    settle(res);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each([401, 403])('records a refused request (%i) as a failure', (statusCode) => {
    const mw = createAuditOnFinish(() => ({ action: 'apikey.create', targetType: 'apikey' }));
    const res = buildRes(statusCode);
    mw(buildReq(), res, jest.fn());
    settle(res);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: 'apikey.create',
      outcome: 'failure',
      actorId: 'u1',
    });
  });

  /**
   * The handler keeps running after the client goes away, so the change may well
   * have landed. Losing the entry entirely made "pull the plug mid-request" a way
   * to mutate permissions untraceably.
   */
  it('records an entry when the client disconnects before the response is written', () => {
    const mw = createAuditOnFinish(() => ({ action: 'role.permissions_update' }));
    const res = buildRes(200);
    mw(buildReq(), res, jest.fn());

    res.emit('close'); // no 'finish', writableEnded stays false

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0].outcome).toBe('unknown');
  });

  it('records exactly one entry on a normal response, though both events fire', () => {
    const mw = createAuditOnFinish(() => ({ action: 'role.permissions_update' }));
    const res = buildRes(200);
    mw(buildReq(), res, jest.fn());
    settle(res);

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0].outcome).toBe('success');
  });

  it('does not resurrect a skipped entry via the close event', () => {
    const mw = createAuditOnFinish(() => ({ action: 'agent.invoke' }));
    const res = buildRes(422);
    mw(buildReq(), res, jest.fn());
    settle(res);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  /**
   * Router-level hooks (grants, config) run before a route is matched, so their
   * `req.params` is filled in only later — resolving on entry would strip the
   * target off every such entry.
   */
  it('reads the request on finish, after the route layer filled in its params', () => {
    const mw = createAuditOnFinish((req) => ({ action: 'user.update', targetId: req.params.id }));
    const res = buildRes(200);
    const req = buildReq({ params: {} });

    mw(req, res, jest.fn());
    req.params = { id: 'u42' };
    res.emit('finish');

    expect(mockRecordAudit.mock.calls[0][0].targetId).toBe('u42');
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
