const axios = require('axios');
const { Tools } = require('librechat-data-provider');

jest.mock('axios');
jest.mock('@librechat/api', () => ({
  generateShortLivedToken: jest.fn(() => 'jwt-token'),
  getRagRerankConfig: jest.fn(() => null),
  rerankOrder: jest.fn(async () => null),
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

describe('createFileSearchTool — суверенный реранк (RAG_RERANKER_URL, фаза 3a)', () => {
  const { getRagRerankConfig, rerankOrder } = require('@librechat/api');

  const RERANK_CONFIG = {
    url: 'http://reranker.internal:8000/v1/rerank',
    token: 'secret',
    candidates: 36,
    timeoutMs: 2500,
  };
  const TWO_FILES = [
    { file_id: 'f1', filename: 'договор.pdf' },
    { file_id: 'f2', filename: 'приложение.pdf' },
  ];
  const chunk = (text, page) => ({ page_content: text, metadata: { source: '/up/x.pdf', page } });

  beforeEach(() => {
    process.env.RAG_API_URL = 'http://rag.internal:8000';
    getRagRerankConfig.mockReturnValue(null);
    rerankOrder.mockResolvedValue(null);
    /* Кросс-файловый мёрж по дистанции: А(0.10, f1) → В(0.20, f2) → Б(0.30, f1). */
    axios.post.mockImplementation((url, body) =>
      Promise.resolve(
        body.file_id === 'f1'
          ? {
              data: [
                [chunk('А: шумовой пункт', 1), 0.1],
                [chunk('Б: пеня за просрочку поставки', 2), 0.3],
              ],
            }
          : { data: [[chunk('В: реквизиты сторон', 5), 0.2]] },
      ),
    );
  });

  it('расширяет пул (k=candidates), реранкает кросс-файлово, relevance = rerank-score', async () => {
    getRagRerankConfig.mockReturnValue(RERANK_CONFIG);
    rerankOrder.mockResolvedValue([
      { index: 2, score: 0.93 },
      { index: 0, score: 0.41 },
      { index: 1, score: 0.12 },
    ]);
    const searchTool = await createFileSearchTool({ userId: 'u1', files: TWO_FILES });
    const msg = await invoke(searchTool);

    expect(axios.post.mock.calls[0][1].k).toBe(36);
    expect(rerankOrder).toHaveBeenCalledTimes(1);
    const args = rerankOrder.mock.calls[0][0];
    expect(args.config).toBe(RERANK_CONFIG);
    expect(args.query).toBe('ИНН');
    expect(args.documents).toEqual([
      'А: шумовой пункт',
      'В: реквизиты сторон',
      'Б: пеня за просрочку поставки',
    ]);

    const sources = msg.artifact[Tools.file_search].sources;
    expect(sources.map((s) => s.content[0])).toEqual(['Б', 'А', 'В']);
    expect(sources[0].relevance).toBe(0.93);
    expect(sources[0].fileId).toBe('f1');
    expect(sources[0].pageRelevance).toEqual({ 2: 0.93 });
    expect(msg.content).toContain('Relevance: 0.9300');
  });

  it('fail-open: rerankOrder=null → порядок по дистанции и дистанционная relevance', async () => {
    getRagRerankConfig.mockReturnValue(RERANK_CONFIG);
    rerankOrder.mockResolvedValue(null);
    const searchTool = await createFileSearchTool({ userId: 'u1', files: TWO_FILES });
    const msg = await invoke(searchTool);

    const sources = msg.artifact[Tools.file_search].sources;
    expect(sources.map((s) => s.content[0])).toEqual(['А', 'В', 'Б']);
    expect(sources[0].relevance).toBeCloseTo(0.9);
  });

  it('выключен (config=null) → прежнее поведение: k=12, реранкер не вызывается', async () => {
    const searchTool = await createFileSearchTool({ userId: 'u1', files: TWO_FILES });
    const msg = await invoke(searchTool);

    expect(axios.post.mock.calls[0][1].k).toBe(12);
    expect(rerankOrder).not.toHaveBeenCalled();
    const sources = msg.artifact[Tools.file_search].sources;
    expect(sources.map((s) => s.content[0])).toEqual(['А', 'В', 'Б']);
    expect(sources[0].relevance).toBeCloseTo(0.9);
  });
});
