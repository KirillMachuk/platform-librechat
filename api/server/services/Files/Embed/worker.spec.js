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
  purgeStoredVectors: jest.fn(),
  fetchDocMetadata: jest.fn().mockResolvedValue(null),
  fetchFullText: jest.fn().mockResolvedValue(null),
  /* Real values, not stubs: the lease clamp sums them with the embed timeout, and the whole point
   * of that clamp is that one claim never outlives its lease (a re-claim = duplicate vectors). */
  METADATA_TIMEOUT_MS: () => 60_000,
  PURGE_TIMEOUT_MS: 60_000,
  logAxiosError: jest.fn(),
}));

jest.mock('~/server/services/Projects/context', () => ({
  invalidateProjectContext: jest.fn(),
}));

require('module-alias/register');
const { embedStoredFile, purgeStoredVectors, fetchDocMetadata, fetchFullText } = require('./crud');
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

  it('invalidates the project context cache when a project file becomes embedded', async () => {
    const { invalidateProjectContext } = require('~/server/services/Projects/context');
    const userId = new mongoose.Types.ObjectId();
    await seed({ file_id: 'proj-1', user: userId, project_id: 'p-42' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    expect(invalidateProjectContext).toHaveBeenCalledWith(userId.toString(), 'p-42');
  });

  it('does not invalidate project context for a non-project (conversation) file', async () => {
    const { invalidateProjectContext } = require('~/server/services/Projects/context');
    await seed({ file_id: 'conv-1' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    expect(invalidateProjectContext).not.toHaveBeenCalled();
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

  it('persists document metadata alongside the ready transition', async () => {
    await seed({ file_id: 'meta-1' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });
    fetchDocMetadata.mockResolvedValueOnce({
      docType: 'договор',
      parties: ['Ромашка', 'Юнифуд'],
      primaryDate: '2024-01-15',
      primaryLocation: 'Минск',
      identifiers: [{ type: 'DOC_NO', value: '312/24' }],
      columns: [],
    });

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'meta-1' }).lean();
    expect(record.embeddingStatus).toBe('ready');
    expect(record.docMetadata.docType).toBe('договор');
    expect(record.docMetadata.parties).toEqual(['Ромашка', 'Юнифуд']);
    expect(record.docMetadata.primaryLocation).toBe('Минск');
    expect(record.docMetadata.identifiers).toEqual([{ type: 'DOC_NO', value: '312/24' }]);
  });

  /* Документы RAG-маршрута читаются `open_document`-ом ТОЛЬКО если воркер сохранил текст.
   * Поле обязано быть `fullText`, а не `text`: путь вложений роутит по наличию `text` и
   * начал бы инлайнить весь документ в каждое сообщение. */
  it('сохраняет полный текст в fullText — и НИКОГДА в text', async () => {
    await seed({ file_id: 'text-1' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });
    fetchFullText.mockResolvedValueOnce('Договор аренды. 14.7. Односторонний отказ...');

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'text-1' }).lean();
    expect(record.embeddingStatus).toBe('ready');
    expect(record.fullText).toContain('Односторонний отказ');
    expect(record.text).toBeUndefined();
  });

  /* Текст — удобство поверх индексации: его потеря не должна стоить пользователю
   * искомого документа (та же политика, что у метаданных). */
  it('fail-open: без текста файл всё равно становится ready и искомым', async () => {
    await seed({ file_id: 'text-2' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });
    fetchFullText.mockResolvedValueOnce(null);

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'text-2' }).lean();
    expect(record.embeddingStatus).toBe('ready');
    expect(record.embedded).toBe(true);
    expect(record.fullText).toBeUndefined();
  });

  it('metadata is extracted only AFTER a successful embed (a failed file is not parsed)', async () => {
    await seed({ file_id: 'noembed-1' });
    embedStoredFile.mockRejectedValueOnce(new Error('boom'));

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    expect(fetchDocMetadata).not.toHaveBeenCalled();
  });

  it('fail-open: no metadata still marks the file ready and searchable', async () => {
    await seed({ file_id: 'nometa-1' });
    embedStoredFile.mockResolvedValueOnce({ embedded: true });
    fetchDocMetadata.mockResolvedValueOnce(null);

    const claimed = await claimNext();
    await processClaimed(claimed, APP_CONFIG);

    const record = await File.findOne({ file_id: 'nometa-1' }).lean();
    expect(record.embeddingStatus).toBe('ready');
    expect(record.embedded).toBe(true);
    expect(record.docMetadata).toBeUndefined();
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

/**
 * `/embed` APPENDS vectors — it never replaces them. So an attempt that dies AFTER the vectors are
 * committed (response timeout, dropped connection, worker crash) leaves them behind, and the retry
 * writes a second full copy. Seen on the lab: one file ended up with exactly RAG_EMBED_MAX_ATTEMPTS
 * copies of every chunk (1420 rows for 284 unique) and then `failed` — silently unsearchable, its
 * duplicates crowding other documents out of the shared retrieval pool.
 */
describe('идемпотентность ретрая: дубли векторов', () => {
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

  const seedPending = (file_id) =>
    File.create({
      user: new mongoose.Types.ObjectId(),
      file_id,
      filename: 'contract.pdf',
      filepath: '/uploads/u1/contract.pdf',
      source: 'local',
      type: 'application/pdf',
      bytes: 1024,
      embeddingStatus: 'pending',
      embedNextAt: new Date(Date.now() - 1000),
      embedAttempts: 0,
    });

  it('первая попытка НЕ платит за удаление: удалять нечего у свежего file_id', async () => {
    await seedPending('fresh');
    const claimed = await claimNext();
    expect(claimed.embedAttempts).toBe(1);

    await processClaimed(claimed, APP_CONFIG);

    expect(purgeStoredVectors).not.toHaveBeenCalled();
    expect(embedStoredFile).toHaveBeenCalledTimes(1);
  });

  it('РЕТРАЙ снимает прежние векторы ПЕРЕД повторным эмбеддингом', async () => {
    await seedPending('retry');
    // Первая попытка падает уже ПОСЛЕ коммита векторов — они остаются в базе.
    embedStoredFile.mockRejectedValueOnce(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    );
    await processClaimed(await claimNext(), APP_CONFIG);
    expect(await File.findOne({ file_id: 'retry' }).then((f) => f.embeddingStatus)).toBe('pending');

    await File.updateOne({ file_id: 'retry' }, { embedNextAt: new Date(Date.now() - 1000) });
    const retry = await claimNext();
    expect(retry.embedAttempts).toBe(2);
    await processClaimed(retry, APP_CONFIG);

    expect(purgeStoredVectors).toHaveBeenCalledTimes(1);
    expect(purgeStoredVectors).toHaveBeenCalledWith({
      file: expect.objectContaining({ file_id: 'retry' }),
    });
    // Порядок решает: удалить ПОСЛЕ эмбеддинга = стереть только что записанное.
    expect(purgeStoredVectors.mock.invocationCallOrder[0]).toBeLessThan(
      embedStoredFile.mock.invocationCallOrder[1],
    );
    expect(await File.findOne({ file_id: 'retry' }).then((f) => f.embeddingStatus)).toBe('ready');
  });

  it('не смогли снять векторы — НЕ эмбеддим: иначе получим ровно тот дубль, от которого лечимся', async () => {
    await seedPending('purge-fails');
    embedStoredFile.mockRejectedValueOnce(new Error('timeout'));
    await processClaimed(await claimNext(), APP_CONFIG);

    await File.updateOne({ file_id: 'purge-fails' }, { embedNextAt: new Date(Date.now() - 1000) });
    purgeStoredVectors.mockRejectedValueOnce(new Error('rag_api down'));
    await processClaimed(await claimNext(), APP_CONFIG);

    expect(embedStoredFile).toHaveBeenCalledTimes(1); // только неудачная первая
    const after = await File.findOne({ file_id: 'purge-fails' });
    expect(after.embeddingStatus).toBe('pending'); // отложили, а не испортили индекс
  });

  it('исчерпание попыток: файл не остаётся с копиями от каждой попытки', async () => {
    await seedPending('exhaust');
    embedStoredFile.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 5; i++) {
      await File.updateOne({ file_id: 'exhaust' }, { embedNextAt: new Date(Date.now() - 1000) });
      await processClaimed(await claimNext(), APP_CONFIG);
    }
    const after = await File.findOne({ file_id: 'exhaust' });
    expect(after.embeddingStatus).toBe('failed');
    // 5 попыток = 5 эмбеддингов, но каждая, кроме первой, начиналась с очистки → копия одна.
    expect(embedStoredFile).toHaveBeenCalledTimes(5);
    expect(purgeStoredVectors).toHaveBeenCalledTimes(4);
  });
});
