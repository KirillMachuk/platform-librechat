/**
 * State-machine tests for the async RAG-embedding worker (RAG_ASYNC_EMBED).
 *
 * Real in-memory Mongo + real data-schemas methods exercise the actual
 * claim/lease/retry transitions; only `./crud` (the axios call to
 * RAG_API_URL/embed — external HTTP) is mocked, per the testing philosophy.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { fileSchema } = require('@librechat/data-schemas');

jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
    runAsSystem: (fn) => fn(),
  };
});

jest.mock('~/models', () => {
  const mongooseModule = require('mongoose');
  const { createMethods } = require('@librechat/data-schemas');
  return createMethods(mongooseModule, {
    removeAllPermissions: jest.fn().mockResolvedValue(undefined),
  });
});

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ paths: { uploads: '/tmp' } }),
}));

jest.mock('./crud', () => ({
  embedStoredFile: jest.fn(),
  logAxiosError: jest.fn(),
}));

require('module-alias/register');
const { embedStoredFile } = require('./crud');
const { backoffMs, claimNext, processClaimed } = require('./worker');

const APP_CONFIG = { paths: { uploads: '/tmp' } };

describe('embed worker state machine', () => {
  let mongoServer;
  let File;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    File = mongoose.models.File || mongoose.model('File', fileSchema);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await File.deleteMany({});
    jest.clearAllMocks();
  });

  const seed = (overrides = {}) =>
    File.create({
      user: new mongoose.Types.ObjectId(),
      file_id: overrides.file_id ?? `f-${Math.random().toString(36).slice(2)}`,
      filename: 'contract.pdf',
      filepath: '/uploads/u1/contract.pdf',
      bytes: 1024,
      object: 'file',
      type: 'application/pdf',
      usage: 0,
      source: 'local',
      embedded: false,
      embeddingStatus: 'pending',
      embedNextAt: new Date(Date.now() - 1000),
      embedAttempts: 0,
      embedEntityId: 'agent_abc',
      ...overrides,
    });

  it('claims a due pending record exactly once (CAS)', async () => {
    await seed({ file_id: 'cas-1' });

    const [first, second] = await Promise.all([claimNext(), claimNext()]);
    const winners = [first, second].filter(Boolean);

    expect(winners).toHaveLength(1);
    expect(winners[0].file_id).toBe('cas-1');
    expect(winners[0].embeddingStatus).toBe('processing');
    expect(winners[0].embedAttempts).toBe(1);
    expect(winners[0].embedNextAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not claim records scheduled in the future', async () => {
    await seed({ embedNextAt: new Date(Date.now() + 60_000) });
    expect(await claimNext()).toBeNull();
  });

  it('reclaims a processing record whose lease expired (crashed worker)', async () => {
    await seed({
      file_id: 'lease-1',
      embeddingStatus: 'processing',
      embedNextAt: new Date(Date.now() - 1000),
      embedAttempts: 1,
    });

    const claimed = await claimNext();
    expect(claimed?.file_id).toBe('lease-1');
    expect(claimed.embedAttempts).toBe(2);
  });

  it('transitions to ready (embedded: true) on success', async () => {
    await seed({ file_id: 'ok-1' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'ok-1' }).lean();
    expect(record.embeddingStatus).toBe('ready');
    expect(record.embedded).toBe(true);
    expect(embedStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ file_id: 'ok-1', embedEntityId: 'agent_abc' }),
      }),
    );
  });

  it('reschedules with backoff on a transient failure (503)', async () => {
    await seed({ file_id: 'busy-1' });
    const error = new Error('busy');
    error.response = { status: 503 };
    embedStoredFile.mockRejectedValueOnce(error);

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'busy-1' }).lean();
    expect(record.embeddingStatus).toBe('pending');
    expect(record.embedded).toBe(false);
    expect(record.embedNextAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('fails permanently on a 4xx response', async () => {
    await seed({ file_id: 'bad-1' });
    const error = new Error('unsupported');
    error.response = { status: 415 };
    embedStoredFile.mockRejectedValueOnce(error);

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'bad-1' }).lean();
    expect(record.embeddingStatus).toBe('failed');
    expect(record.embedError).toBe('http-415');
  });

  it('fails with max-retries once attempts are exhausted', async () => {
    await seed({ file_id: 'tired-1', embedAttempts: 4 });
    const error = new Error('still busy');
    error.response = { status: 503 };
    embedStoredFile.mockRejectedValueOnce(error);

    const claimed = await claimNext();
    expect(claimed.embedAttempts).toBe(5);
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'tired-1' }).lean();
    expect(record.embeddingStatus).toBe('failed');
    expect(record.embedError).toBe('max-retries');
  });

  it('grows backoff exponentially and caps it', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(4)).toBe(480_000);
    expect(backoffMs(10)).toBe(15 * 60_000);
  });

  it('clears a stale embedError when rescheduling a transient failure', async () => {
    await seed({ file_id: 'stale-err', embedError: 'http-500' });
    const error = new Error('busy');
    error.response = { status: 503 };
    embedStoredFile.mockRejectedValueOnce(error);

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'stale-err' }).lean();
    expect(record.embeddingStatus).toBe('pending');
    expect(record.embedError ?? null).toBeNull();
  });

  it('leases a claim for longer than the embed timeout (no double-claim window)', async () => {
    const prev = {
      lease: process.env.RAG_EMBED_LEASE_MS,
      timeout: process.env.RAG_EMBED_TIMEOUT_MS,
    };
    process.env.RAG_EMBED_LEASE_MS = '1000'; // 1s — deliberately below timeout
    process.env.RAG_EMBED_TIMEOUT_MS = '600000'; // 10m
    try {
      await seed({ file_id: 'lease-clamp' });
      const before = Date.now();
      const claimed = await claimNext();
      // lease is clamped to TIMEOUT + 60s, so the next-attempt time is far in
      // the future — a second worker cannot re-claim while the first embeds.
      expect(claimed.embedNextAt.getTime() - before).toBeGreaterThan(600_000);
    } finally {
      process.env.RAG_EMBED_LEASE_MS = prev.lease;
      process.env.RAG_EMBED_TIMEOUT_MS = prev.timeout;
    }
  });
});
