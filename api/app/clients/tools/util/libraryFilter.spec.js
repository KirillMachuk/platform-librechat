const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { fileSchema } = require('@librechat/data-schemas');

jest.mock('@librechat/api', () => ({
  generateShortLivedToken: jest.fn(() => 'jwt-token'),
  getRagRerankConfig: jest.fn(() => null),
  getLibrarySearchConfig: jest.fn(() => ({})),
  searchLibrary: jest.fn(),
  LibrarySearchUnavailableError: class extends Error {},
}));
jest.mock('~/models', () => ({ getFiles: jest.fn(), countFiles: jest.fn() }));

const { buildFilterClause, buildUnfilterableClause } = require('./librarySearch');

/**
 * Attribute filters run as a REAL Mongo query, so they are tested against a real in-memory Mongo:
 * the risky parts (Cyrillic case folding, «ё»/«е», substring matching inside an array of parties,
 * ISO date range as strings) cannot be verified by asserting on a mocked query object — that would
 * only prove we build the shape we imagined, not that Mongo agrees.
 *
 * Semantics are the ones the Ф3 gate measured (parser-bench/rag-recall/RESULTS_META.md):
 * typed fields, header-only place/date, substring name match (recall over precision).
 */
describe('library attribute filters (real Mongo)', () => {
  let mongoServer;
  let File;

  const seed = (file_id, docMetadata, extra = {}) =>
    File.create({
      user: new mongoose.Types.ObjectId(),
      file_id,
      filename: `${file_id}.pdf`,
      filepath: `/uploads/${file_id}.pdf`,
      bytes: 1,
      object: 'file',
      type: 'application/pdf',
      usage: 0,
      source: 'local',
      embedded: true,
      ...(docMetadata ? { docMetadata } : {}),
      ...extra,
    });

  const found = async (filters) => {
    const clause = buildFilterClause(filters);
    const docs = await File.find(clause ? { embedded: true, ...clause } : { embedded: true })
      .select('file_id')
      .lean();
    return docs.map((d) => d.file_id).sort();
  };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    File = mongoose.models.File || mongoose.model('File', fileSchema);

    await seed('lease-minsk', {
      docType: 'договор',
      parties: ['Ромашка Плюс', 'Юнифуд'],
      primaryDate: '2024-01-15',
      primaryLocation: 'Минск',
      identifiers: [{ type: 'DOC_NO', value: '312/24' }],
      columns: [],
    });
    await seed('lease-mogilev', {
      docType: 'договор',
      parties: ['Василёк'],
      primaryDate: '2025-06-01',
      primaryLocation: 'Могилёв',
      identifiers: [],
      columns: [],
    });
    await seed('policy-2025', {
      docType: 'положение',
      parties: [],
      primaryDate: '2025-03-10',
      primaryLocation: null,
      identifiers: [],
      columns: [],
    });
    await seed('invoice-2025', {
      docType: 'счёт',
      parties: ['Ромашка Плюс'],
      primaryDate: '2025-02-02',
      primaryLocation: 'Минск',
      identifiers: [],
      columns: [],
    });
    /* Таблица: сторон/даты/места у CSV нет НИКОГДА — по построению извлекателя, а не по сбою. */
    await seed('clients-table', {
      docType: 'таблица',
      parties: [],
      primaryDate: null,
      primaryLocation: null,
      identifiers: [],
      columns: ['компания', 'телефон'],
    });
    /* Скан с нераспознанным заголовком: метаданные ЕСТЬ, но вид неизвестен. */
    await seed('scan-unknown', {
      docType: 'иное',
      parties: [],
      primaryDate: null,
      primaryLocation: null,
      identifiers: [],
      columns: [],
    });
    await seed('legacy-no-meta', null);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('no filters → no clause at all (tool behaves exactly as before Ф3)', () => {
    expect(buildFilterClause({})).toBeNull();
    expect(buildFilterClause(undefined)).toBeNull();
    expect(buildFilterClause({ doc_type: '   ' })).toBeNull();
  });

  it('matches the kind through «ё»/«е» — the model writes "счет", the extractor stored "счёт"', async () => {
    /* Canonical kinds carry ё ("счёт", "отчёт"), but ё is optional in written Russian and a model
     * generating it almost always drops it. A byte-exact compare answered "no such documents" on
     * a library full of them. */
    await expect(found({ doc_type: 'счет' })).resolves.toEqual(['invoice-2025']);
    await expect(found({ doc_type: 'счёт' })).resolves.toEqual(['invoice-2025']);
    await expect(found({ doc_type: 'ДОГОВОР' })).resolves.toEqual(['lease-minsk', 'lease-mogilev']);
  });

  it('filters by document kind', async () => {
    await expect(found({ doc_type: 'договор' })).resolves.toEqual(['lease-minsk', 'lease-mogilev']);
    await expect(found({ doc_type: 'положение' })).resolves.toEqual(['policy-2025']);
  });

  it('matches a party by substring — the user types the short name', async () => {
    await expect(found({ org: 'Ромашка' })).resolves.toEqual(['invoice-2025', 'lease-minsk']);
    await expect(found({ doc_type: 'договор', org: 'Ромашка' })).resolves.toEqual(['lease-minsk']);
  });

  it('matches Cyrillic case-insensitively', async () => {
    await expect(found({ org: 'ромашка' })).resolves.toEqual(['invoice-2025', 'lease-minsk']);
    await expect(found({ location: 'МИНСК' })).resolves.toEqual(['invoice-2025', 'lease-minsk']);
  });

  it('treats «ё» and «е» as the same letter (users type Могилев, documents say Могилёв)', async () => {
    await expect(found({ location: 'Могилев' })).resolves.toEqual(['lease-mogilev']);
    await expect(found({ location: 'Могилёв' })).resolves.toEqual(['lease-mogilev']);
    await expect(found({ org: 'василек' })).resolves.toEqual(['lease-mogilev']);
  });

  it('filters by the document own date range (ISO strings compare chronologically)', async () => {
    await expect(found({ date_from: '2025-01-01', date_to: '2025-12-31' })).resolves.toEqual([
      'invoice-2025',
      'lease-mogilev',
      'policy-2025',
    ]);
    await expect(found({ doc_type: 'договор', date_from: '2025-01-01' })).resolves.toEqual([
      'lease-mogilev',
    ]);
  });

  it('combines attributes as AND', async () => {
    await expect(found({ doc_type: 'договор', location: 'Минск' })).resolves.toEqual([
      'lease-minsk',
    ]);
    await expect(found({ doc_type: 'договор', location: 'Гомель' })).resolves.toEqual([]);
  });

  it('a date with stray whitespace still matches its own day', async () => {
    /* `$` in JS also matches before a trailing newline, so "2024-01-15\n" passed validation and
     * compared GREATER than "2024-01-15" — the document dated exactly that day silently vanished
     * from a $gte range. */
    await expect(found({ date_from: '2024-01-15\n', date_to: '2024-01-15 ' })).resolves.toEqual([
      'lease-minsk',
    ]);
  });

  it('ignores a malformed date instead of dropping the whole library', async () => {
    expect(buildFilterClause({ date_from: 'в прошлом году' })).toBeNull();
    await expect(found({ doc_type: 'договор', date_to: '15.01.2024' })).resolves.toEqual([
      'lease-minsk',
      'lease-mogilev',
    ]);
  });

  it('escapes regex metacharacters coming from the model (no injection, no ReDoS)', async () => {
    await expect(found({ org: '.*' })).resolves.toEqual([]);
    await expect(found({ location: 'Мин(ск' })).resolves.toEqual([]);
  });

  it('caps a filter value so a prompt-injected wall of text cannot become a huge $regex', async () => {
    /* The value reaches us from the model, so a prompt injection could hand it 100k characters;
     * Mongo would then run that pattern against every file the user owns. Truncation keeps the
     * search working (substring still matches) instead of erroring out. */
    const clause = buildFilterClause({ org: `Ромашка${'я'.repeat(5000)}` });
    expect(clause['docMetadata.parties'].$regex.length).toBeLessThanOrEqual(220);
    await expect(found({ org: `Ромашка${'я'.repeat(5000)}` })).resolves.toEqual([]);
    await expect(found({ org: 'Ромашка' })).resolves.toEqual(['invoice-2025', 'lease-minsk']);
  });

  it('a document whose FIELD is empty counts as unfilterable, not as filtered out', async () => {
    /* The gap is per-field, not just "no metadata at all": a table has no parties by construction,
     * a badly-OCR'd scan has kind "иное". Treat them as filtered out and "show me all contracts
     * with Ромашка" walks past them while the model reports a complete answer. */
    const unfilterable = buildUnfilterableClause({ org: 'Ромашка' });
    const docs = await File.find({ embedded: true, ...unfilterable })
      .select('file_id')
      .lean();
    expect(docs.map((d) => d.file_id).sort()).toEqual([
      'clients-table',
      'legacy-no-meta',
      'policy-2025',
      'scan-unknown',
    ]);

    const byKind = buildUnfilterableClause({ doc_type: 'договор' });
    const kindDocs = await File.find({ embedded: true, ...byKind })
      .select('file_id')
      .lean();
    expect(kindDocs.map((d) => d.file_id).sort()).toEqual(['legacy-no-meta', 'scan-unknown']);
  });

  it('a document with no metadata never matches a filter clause on its own', async () => {
    /* The tool keeps such files in scope via `$or: [clause, { docMetadata: { $exists: false } }]`
     * — see primeLibraryScope: a filter must not silently hide documents indexed before Ф3. */
    await expect(found({ doc_type: 'договор' })).resolves.not.toContain('legacy-no-meta');
    const clause = buildFilterClause({ doc_type: 'договор' });
    const withUnknown = await File.find({
      embedded: true,
      $or: [clause, { docMetadata: { $exists: false } }],
    })
      .select('file_id')
      .lean();
    expect(withUnknown.map((d) => d.file_id).sort()).toEqual([
      'lease-minsk',
      'lease-mogilev',
      'legacy-no-meta',
    ]);
  });
});
