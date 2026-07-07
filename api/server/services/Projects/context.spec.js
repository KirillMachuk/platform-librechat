const mockStore = new Map();
const mockCache = {
  get: jest.fn(async (k) => mockStore.get(k)),
  set: jest.fn(async (k, v) => void mockStore.set(k, v)),
  delete: jest.fn(async (k) => mockStore.delete(k)),
};
jest.mock('~/cache/getLogStores', () => jest.fn(() => mockCache));

jest.mock('~/models', () => ({
  getProjectById: jest.fn(),
  getFiles: jest.fn(),
}));

const { getProjectContext, invalidateProjectContext } = require('./context');
const { getProjectById, getFiles } = require('~/models');

describe('project context cache (C-PRJ-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
  });

  it('loads from Mongo on a cache miss and caches the result', async () => {
    getProjectById.mockResolvedValue({ instructions: '  Do legal review  ' });
    getFiles.mockResolvedValue([{ file_id: 'f1' }, { file_id: 'f2' }]);

    const ctx = await getProjectContext('u1', 'p1');

    expect(ctx).toEqual({ instructions: 'Do legal review', fileIds: ['f1', 'f2'] });
    expect(getProjectById).toHaveBeenCalledTimes(1);
    expect(mockStore.get('u1:p1')).toEqual(ctx);
  });

  it('serves a cache hit without touching Mongo', async () => {
    mockStore.set('u1:p1', { instructions: 'cached', fileIds: [] });

    const ctx = await getProjectContext('u1', 'p1');

    expect(ctx).toEqual({ instructions: 'cached', fileIds: [] });
    expect(getProjectById).not.toHaveBeenCalled();
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('caches a negative result for a missing/foreign project and returns null', async () => {
    getProjectById.mockResolvedValue(null);

    expect(await getProjectContext('u1', 'nope')).toBeNull();
    expect(await getProjectContext('u1', 'nope')).toBeNull();
    expect(getProjectById).toHaveBeenCalledTimes(1);
    expect(getFiles).not.toHaveBeenCalled();
  });

  it('invalidateProjectContext drops the cached entry', async () => {
    mockStore.set('u1:p1', { instructions: 'stale', fileIds: [] });

    await invalidateProjectContext('u1', 'p1');
    expect(mockStore.has('u1:p1')).toBe(false);

    getProjectById.mockResolvedValue({ instructions: 'fresh' });
    getFiles.mockResolvedValue([]);
    const ctx = await getProjectContext('u1', 'p1');
    expect(ctx.instructions).toBe('fresh');
  });

  it('falls back to Mongo when the cache read throws', async () => {
    mockCache.get.mockRejectedValueOnce(new Error('redis down'));
    getProjectById.mockResolvedValue({ instructions: 'live' });
    getFiles.mockResolvedValue([]);

    const ctx = await getProjectContext('u1', 'p1');
    expect(ctx.instructions).toBe('live');
  });
});
