import { createAuditRecorder, auditRequestContext } from './service';

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('createAuditRecorder', () => {
  it('forwards the event to recordAuditLog', async () => {
    const recordAuditLog = jest.fn().mockResolvedValue(undefined);
    const { recordAudit } = createAuditRecorder({ recordAuditLog });

    recordAudit({ action: 'auth.login', outcome: 'success', actorEmail: 'a@x.io' });
    await flush();

    expect(recordAuditLog).toHaveBeenCalledTimes(1);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', actorEmail: 'a@x.io' }),
    );
  });

  it('returns synchronously (does not block the caller)', () => {
    const recordAuditLog = jest.fn().mockResolvedValue(undefined);
    const { recordAudit } = createAuditRecorder({ recordAuditLog });

    const result = recordAudit({ action: 'auth.logout', outcome: 'success' });

    expect(result).toBeUndefined();
  });

  it('swallows rejection from recordAuditLog (never throws into the caller)', async () => {
    const recordAuditLog = jest.fn().mockRejectedValue(new Error('db down'));
    const { recordAudit } = createAuditRecorder({ recordAuditLog });

    expect(() => recordAudit({ action: 'auth.login_failed', outcome: 'failure' })).not.toThrow();
    await flush();

    expect(recordAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe('auditRequestContext', () => {
  it('extracts ip and user-agent', () => {
    expect(auditRequestContext({ ip: '1.2.3.4', headers: { 'user-agent': 'jest' } })).toEqual({
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
  });

  it('handles a missing request and missing headers', () => {
    expect(auditRequestContext()).toEqual({});
    expect(auditRequestContext({ ip: '1.2.3.4' })).toEqual({ ip: '1.2.3.4', userAgent: undefined });
  });

  it('ignores a non-string user-agent', () => {
    expect(
      auditRequestContext({ headers: { 'user-agent': ['a', 'b'] } }).userAgent,
    ).toBeUndefined();
  });
});
