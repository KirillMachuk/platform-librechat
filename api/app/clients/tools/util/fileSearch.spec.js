const axios = require('axios');
const { Tools } = require('librechat-data-provider');

jest.mock('axios');
jest.mock('@librechat/api', () => ({ generateShortLivedToken: jest.fn(() => 'jwt-token') }));
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
