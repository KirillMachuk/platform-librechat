const axios = require('axios');

jest.mock('axios');
jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  generateShortLivedToken: jest.fn(() => 'token'),
}));

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

  it('stays silent for a file that never entered the embed lifecycle', async () => {
    await deleteVectors(req, { file_id: 'photo', embedded: false });

    expect(axios.delete).not.toHaveBeenCalled();
  });

  it('stays silent when no vector store is configured', async () => {
    delete process.env.RAG_API_URL;

    await deleteVectors(req, { file_id: 'ready', embedded: true });

    expect(axios.delete).not.toHaveBeenCalled();
  });

  it('reports a file as possibly holding vectors only on those two grounds', () => {
    expect(mayHaveVectors({ embedded: true })).toBe(true);
    expect(mayHaveVectors({ embeddingStatus: 'pending' })).toBe(true);
    expect(mayHaveVectors({ embedded: false })).toBe(false);
    expect(mayHaveVectors(undefined)).toBe(false);
  });
});
