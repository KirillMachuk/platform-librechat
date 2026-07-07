const axios = require('axios');
const { Tools } = require('librechat-data-provider');

jest.mock('axios');
jest.mock('@librechat/api', () => ({
  generateShortLivedToken: jest.fn(() => 'jwt-token'),
  logAxiosError: jest.fn(),
  createConcurrencyLimiter: jest.fn(() => (task) => task()),
}));
jest.mock('~/server/services/Files/permissions', () => ({ filterFilesByAgentAccess: jest.fn() }));
jest.mock('~/models', () => ({ getFiles: jest.fn() }));

const { createFileSearchTool } = require('./fileSearch');

const FILES = [{ file_id: 'f1', filename: 'договор.pdf' }];
const RAG_RESULT = {
  data: [
    [
      {
        page_content: 'ООО Ромашка, ИНН 7701234567',
        metadata: { source: '/uploads/договор.pdf', page: 3 },
      },
      0.12,
    ],
  ],
};

/** Invoke the content_and_artifact tool via a tool_call so we get the full ToolMessage. */
function invoke(searchTool) {
  return searchTool.invoke({
    name: Tools.file_search,
    args: { query: 'ИНН' },
    id: 't1',
    type: 'tool_call',
  });
}

describe('createFileSearchTool — transformContent (sovereign DR file_search masking)', () => {
  beforeEach(() => {
    process.env.RAG_API_URL = 'http://rag.internal:8000';
    axios.post.mockResolvedValue(RAG_RESULT);
  });

  it('masks the model-visible content but leaves the artifact (UI citations) raw', async () => {
    const transformContent = jest.fn(async () => 'Документ: [ORG_1], ИНН [INN_1]');
    const searchTool = await createFileSearchTool({
      userId: 'u1',
      files: FILES,
      fileCitations: true,
      transformContent,
    });
    const msg = await invoke(searchTool);

    // transformContent received the formatted chunk text (the raw PII), and its result is what egresses.
    expect(transformContent).toHaveBeenCalledTimes(1);
    expect(transformContent.mock.calls[0][0]).toContain('ООО Ромашка, ИНН 7701234567');
    expect(msg.content).toBe('Документ: [ORG_1], ИНН [INN_1]');

    // The artifact is the user's own data shown back to them (never egressed) — stays raw.
    expect(msg.artifact[Tools.file_search].sources[0].content).toBe('ООО Ромашка, ИНН 7701234567');
  });

  it('is a no-op passthrough when transformContent is omitted (standard agent path)', async () => {
    const searchTool = await createFileSearchTool({
      userId: 'u1',
      files: FILES,
      fileCitations: true,
    });
    const msg = await invoke(searchTool);
    expect(msg.content).toContain('ООО Ромашка, ИНН 7701234567');
  });
});

describe('createFileSearchTool — RAG query-path hardening (D4/D5/D16)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://rag.internal:8000';
    axios.post.mockResolvedValue(RAG_RESULT);
  });

  it('D4: sends a finite timeout on every /query call', async () => {
    const searchTool = await createFileSearchTool({ userId: 'u1', files: FILES });
    await invoke(searchTool);
    expect(axios.post.mock.calls[0][2].timeout).toBe(30000);
  });

  it('D5: a failed file query does not misattribute the surviving file_id', async () => {
    const files = [
      { file_id: 'f1', filename: 'broken.pdf' },
      { file_id: 'f2', filename: 'good.pdf' },
    ];
    axios.post.mockReset();
    axios.post
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        data: [[{ page_content: 'срок 5 лет', metadata: { source: '/uploads/good.pdf', page: 1 } }, 0.2]],
      });

    const searchTool = await createFileSearchTool({ userId: 'u1', files });
    const msg = await invoke(searchTool);

    // Only f2 survived; its source must carry f2's id, not the drifted index.
    const sources = msg.artifact[Tools.file_search].sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].fileId).toBe('f2');
    expect(msg.content).toContain('срок 5 лет');
  });

  it('D16: a malformed /query payload is tolerated (no crash, no hits)', async () => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: [[{ noPageContent: true }, 0.5], null, 'garbage'] });

    const searchTool = await createFileSearchTool({ userId: 'u1', files: FILES });
    const msg = await invoke(searchTool);

    expect(typeof msg.content).toBe('string');
    expect(msg.content).toMatch(/No content found/i);
  });
});
