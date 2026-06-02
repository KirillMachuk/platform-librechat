import { createAuditRecorder, createAuditBackfiller, auditRequestContext } from './service';

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

describe('createAuditBackfiller', () => {
  it('runs both derivations with a since watermark and sums the counts', async () => {
    const backfillAuditFromTransactions = jest.fn().mockResolvedValue({ scanned: 4, inserted: 2 });
    const backfillAgentInvokes = jest.fn().mockResolvedValue({ scanned: 6, inserted: 1 });
    const { runBackfill } = createAuditBackfiller({
      backfillAuditFromTransactions,
      backfillAgentInvokes,
    });

    const now = 10 * 60 * 60 * 1000;
    const result = await runBackfill({ now, lookbackMs: 2 * 60 * 60 * 1000 });

    expect(result).toEqual({ scanned: 10, inserted: 3 });
    const expectedSince = new Date(now - 2 * 60 * 60 * 1000);
    expect(backfillAuditFromTransactions).toHaveBeenCalledWith({ since: expectedSince });
    expect(backfillAgentInvokes).toHaveBeenCalledWith({ since: expectedSince });
  });

  it('returns zeroed counts and never throws when a derivation fails', async () => {
    const { runBackfill } = createAuditBackfiller({
      backfillAuditFromTransactions: jest.fn().mockRejectedValue(new Error('db down')),
      backfillAgentInvokes: jest.fn().mockResolvedValue({ scanned: 1, inserted: 1 }),
    });

    await expect(runBackfill({ now: Date.now(), lookbackMs: 1000 })).resolves.toEqual({
      scanned: 0,
      inserted: 0,
    });
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
