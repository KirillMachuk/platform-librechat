const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditDeepResearchChange = require('./auditDeepResearchChange');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
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

describe('auditDeepResearchChange', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records set_active_mode with the chosen tier', () => {
    const req = buildReq({ body: { activeMode: 'balanced' } });
    const res = buildRes(200);
    const next = jest.fn();

    auditDeepResearchChange(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled(); // not until finish

    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deep_research.set_active_mode',
        targetType: 'deep_research',
        targetId: 'balanced',
        actorEmail: 'admin@x.io',
        outcome: 'success',
        ip: '1.2.3.4',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({ activeMode: 'balanced' });
  });

  it('records set_models with mode + both models', () => {
    const req = buildReq({
      body: { mode: 'deep', leadModel: 'opus-4.8', workerModel: 'sonnet-4.6' },
    });
    const res = buildRes(200);
    auditDeepResearchChange(req, res, jest.fn());
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deep_research.set_models',
        targetType: 'deep_research',
        targetId: 'deep',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      mode: 'deep',
      leadModel: 'opus-4.8',
      workerModel: 'sonnet-4.6',
    });
  });

  it('records only the model role that was provided (partial update)', () => {
    const req = buildReq({ body: { mode: 'economy', leadModel: 'deepseek-chat-v3.1' } });
    const res = buildRes(200);
    auditDeepResearchChange(req, res, jest.fn());
    res.emit('finish');

    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      mode: 'economy',
      leadModel: 'deepseek-chat-v3.1',
    });
  });

  it('does not record a failed write (status >= 400)', () => {
    const res = buildRes(400);
    auditDeepResearchChange(buildReq({ body: { activeMode: 'deep' } }), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('ignores read (GET) requests entirely', () => {
    const res = buildRes(200);
    const next = jest.fn();
    auditDeepResearchChange(buildReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('skips a PUT with neither mode nor activeMode', () => {
    const res = buildRes(200);
    auditDeepResearchChange(buildReq({ body: {} }), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
