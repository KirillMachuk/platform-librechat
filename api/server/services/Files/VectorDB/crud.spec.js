const axios = require('axios');

jest.mock('axios');
jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  generateShortLivedToken: jest.fn(() => 'token'),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const { logger } = require('@librechat/data-schemas');
const { deleteVectors, mayHaveVectors } = require('./crud');

const req = { user: { id: 'user-123' } };

describe('deleteVectors — which files are worth asking the vector store about', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://rag';
    axios.delete.mockResolvedValue({ status: 200 });
  });

  it('drops the chunks of a committed file', async () => {
    await deleteVectors(req, { file_id: 'ready', embedded: true, embeddingStatus: 'ready' });

    expect(axios.delete).toHaveBeenCalledWith(
      'http://rag/documents',
      expect.objectContaining({ data: ['ready'] }),
    );
  });

  /* The record is written before the embed runs, and an attempt that timed out on our side never
   * proved the doc-gateway committed nothing — that is why a retry purges before re-embedding.
   * A file deleted between attempts therefore still reads `embedded: false` while owning chunks,
   * and skipping it here leaves the document's text in the index with no record left to own it. */
  it('drops the chunks of a file whose embed never finished', async () => {
    for (const embeddingStatus of ['pending', 'processing', 'failed']) {
      await deleteVectors(req, { file_id: embeddingStatus, embedded: false, embeddingStatus });
    }

    expect(axios.delete).toHaveBeenCalledTimes(3);
    expect(axios.delete.mock.calls.map(([, config]) => config.data)).toEqual([
      ['pending'],
      ['processing'],
      ['failed'],
    ]);
  });

  it('carries a timeout so a hung vector store cannot hang the delete', async () => {
    await deleteVectors(req, { file_id: 'ready', embedded: true });

    expect(axios.delete).toHaveBeenCalledWith(
      'http://rag/documents',
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('treats a 404 as nothing left to delete', async () => {
    axios.delete.mockRejectedValueOnce({ response: { status: 404 }, message: 'not found' });

    await expect(deleteVectors(req, { file_id: 'ready', embedded: true })).resolves.toBeUndefined();
  });

  /* A refused connection, a timeout or a DNS failure carries no `error.response`. Reading that as
   * success is how a document's text ends up in the index with no record left to link it to its
   * owner: the caller marks the file deleted and drops its record. While the record lives the
   * delete can be retried, so every non-404 failure has to reach the caller. */
  it.each([
    [
      'connection refused',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    ],
    ['timeout', Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' })],
    ['server error', { response: { status: 500 }, message: 'boom' }],
  ])('refuses to report success when the vector store failed: %s', async (_name, failure) => {
    axios.delete.mockRejectedValueOnce(failure);

    await expect(deleteVectors(req, { file_id: 'ready', embedded: true })).rejects.toThrow();
  });

  it('stays silent for a file that never entered the embed lifecycle', async () => {
    await deleteVectors(req, { file_id: 'photo', embedded: false });

    expect(axios.delete).not.toHaveBeenCalled();
  });

  it('warns instead of staying silent when no vector store is configured', async () => {
    delete process.env.RAG_API_URL;

    await deleteVectors(req, { file_id: 'ready', embedded: true });

    expect(axios.delete).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ready'));
  });

  it('reports a file as possibly holding vectors only on those two grounds', () => {
    expect(mayHaveVectors({ embedded: true })).toBe(true);
    expect(mayHaveVectors({ embeddingStatus: 'pending' })).toBe(true);
    expect(mayHaveVectors({ embedded: false })).toBe(false);
    expect(mayHaveVectors(undefined)).toBe(false);
  });
});
