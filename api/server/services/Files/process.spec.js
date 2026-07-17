jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
  runAsSystem: jest.fn((fn) => fn()),
  createTempChatExpirationDate: jest.fn(() => new Date('2030-01-01T00:00:00.000Z')),
}));

jest.mock('@librechat/agents', () => ({
  Providers: {
    XAI: 'xai',
    DEEPSEEK: 'deepseek',
    MOONSHOT: 'moonshot',
    OPENROUTER: 'openrouter',
    VERTEXAI: 'vertexai',
  },
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    Providers: actual.Providers,
    RetentionMode: actual.RetentionMode ?? { ALL: 'all', TEMPORARY: 'temporary' },
    documentParserMimeTypes: actual.documentParserMimeTypes ?? [
      /^application\/pdf$/,
      /^application\/vnd\.openxmlformats-officedocument\./,
      /^application\/vnd\.ms-excel$/,
      /^application\/vnd\.oasis\.opendocument\./,
      /^application\/(?:x-)?msexcel$/,
    ],
    mergeFileConfig: jest.fn(),
  };
});

jest.mock('@librechat/api', () => {
  const actualDataProvider = jest.requireActual('librechat-data-provider');
  const RetentionMode = actualDataProvider.RetentionMode ?? { ALL: 'all', TEMPORARY: 'temporary' };
  const getRetentionExpiry = jest.fn(() => ({}));
  return {
    sanitizeFilename: jest.fn((n) => n),
    parseText: jest.fn().mockResolvedValue({ text: '', bytes: 0 }),
    parseTextNative: jest.fn().mockResolvedValue({ text: 'native-parsed', bytes: 13 }),
    // Pass-through by default so existing tests are unaffected; individual D6
    // tests override with mockRejectedValueOnce to simulate a timeout.
    withTimeout: jest.fn((promise) => promise),
    processAudioFile: jest.fn(),
    getStorageMetadata: jest.fn(() => ({})),
    // Faithful minimal limiter (same algorithm as the real one) so the D12
    // concurrency-cap test observes real bounding rather than a pass-through.
    createConcurrencyLimiter: (concurrency) => {
      let active = 0;
      const queue = [];
      const release = () => {
        active--;
        const next = queue.shift();
        if (next) next();
      };
      return (task) =>
        new Promise((resolve, reject) => {
          const run = () => {
            active++;
            Promise.resolve()
              .then(task)
              .then(
                (value) => {
                  release();
                  resolve(value);
                },
                (error) => {
                  release();
                  reject(error);
                },
              );
          };
          if (active < concurrency) run();
          else queue.push(run);
        });
    },
    getRetentionExpiry,
    getAgentFileRetentionExpiry: jest.fn(({ req, messageAttachment, toolResource }) => {
      const interfaceConfig = req?.config?.interfaceConfig;
      if (
        !messageAttachment &&
        !!toolResource &&
        (interfaceConfig?.retentionMode !== RetentionMode.ALL ||
          interfaceConfig?.retainAgentFiles === true)
      ) {
        return {};
      }
      return getRetentionExpiry(req);
    }),
    sweepExpiredFiles: jest.fn().mockResolvedValue({ scanned: 0, deleted: 0, failed: 0 }),
    startExpiredFileSweep: jest.fn().mockReturnValue('sweep-interval'),
    probePdf: jest.fn().mockResolvedValue({ pageCount: 0, textChars: 0 }),
    routePdfBySize: jest.fn(),
    isContentRoutingEnabled: jest.fn(() => false),
    readDocRoutingThresholds: jest.fn(() => ({ maxContextChars: 40000, maxContextScanPages: 12 })),
    isImageOcrEnabled: jest.fn(() => false),
    imageOcrMinChars: jest.fn(() => 150),
    acceptOcrText: jest.fn(() => false),
    isOfficeHtmlPreviewable: jest.fn(() => false),
    renderOfficePreview: jest.fn(),
  };
});

jest.mock('~/server/services/Files/images', () => ({
  convertImage: jest.fn(),
  resizeAndConvert: jest.fn(),
  resizeImageBuffer: jest.fn(),
}));

jest.mock('~/server/controllers/assistants/v2', () => ({
  addResourceFileId: jest.fn(),
  deleteResourceFileId: jest.fn(),
}));

jest.mock('~/server/controllers/assistants/helpers', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: jest.fn(),
}));

jest.mock('~/models', () => ({
  createFile: jest.fn().mockResolvedValue({ file_id: 'created-file-id' }),
  updateFile: jest.fn().mockResolvedValue({}),
  updateFileUsage: jest.fn(),
  deleteFiles: jest.fn(),
  findFileById: jest.fn(),
  getConvo: jest.fn(),
  getExpiredFiles: jest.fn(),
  addAgentResourceFile: jest.fn().mockResolvedValue({}),
  removeAgentResourceFiles: jest.fn(),
  removeAgentResourceFilesFromAllAgents: jest.fn(),
}));

jest.mock('~/server/utils/getFileStrategy', () => ({
  getFileStrategy: jest.fn().mockReturnValue('local'),
}));

jest.mock('~/server/services/Config', () => ({
  checkCapability: jest.fn().mockResolvedValue(true),
}));

jest.mock('~/server/utils/queue', () => ({
  LB_QueueAsyncCall: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('./VectorDB/crud', () => ({
  uploadVectors: jest.fn().mockResolvedValue({
    bytes: 42,
    filename: 'upload.bin',
    filepath: 'vectordb',
    embedded: true,
  }),
  deleteVectors: jest.fn(),
}));

jest.mock('./Embed', () => ({
  asyncEmbedEnabled: jest.fn(() => false),
}));

jest.mock('~/server/utils', () => ({
  determineFileType: jest.fn(),
}));

jest.mock('~/server/services/Files/Audio/STTService', () => ({
  STTService: { getInstance: jest.fn() },
}));

const {
  getRetentionExpiry,
  getAgentFileRetentionExpiry,
  probePdf,
  withTimeout,
  routePdfBySize,
  sweepExpiredFiles: sweepExpiredFilesWithDeps,
  startExpiredFileSweep: startExpiredFileSweepWithDeps,
} = require('@librechat/api');
const {
  EToolResources,
  FileSources,
  FileContext,
  RetentionMode,
  AgentCapabilities,
} = require('librechat-data-provider');
const { mergeFileConfig } = require('librechat-data-provider');
const { checkCapability } = require('~/server/services/Config');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { uploadVectors } = require('./VectorDB/crud');
const db = require('~/models');
const {
  processAgentFileUpload,
  processDeleteRequest,
  processFileURL,
  sweepExpiredFiles,
  startExpiredFileSweep,
  resolveLargeDocRouting,
  resolveContentRouting,
  resolveUploadPrivacy,
} = require('./process');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
const ODG_MIME = 'application/vnd.oasis.opendocument.graphics';

const makeReq = ({ mimetype = PDF_MIME, ocrConfig = null, interfaceConfig, body } = {}) => ({
  user: { id: 'user-123', tenantId: 'tenant-a' },
  file: {
    path: '/tmp/upload.bin',
    originalname: 'upload.bin',
    filename: 'upload-uuid.bin',
    mimetype,
  },
  body: { model: 'gpt-4o', ...body },
  config: {
    fileConfig: {},
    fileStrategy: 'local',
    ocr: ocrConfig,
    ...(interfaceConfig ? { interfaceConfig } : {}),
  },
});

const makeMetadata = () => ({
  agent_id: 'agent-abc',
  tool_resource: EToolResources.context,
  file_id: 'file-uuid-123',
});

const mockRes = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnValue({}),
};

const makeFileConfig = ({ ocrSupportedMimeTypes = [] } = {}) => ({
  checkType: (mime, types) => (types ?? []).includes(mime),
  ocr: { supportedMimeTypes: ocrSupportedMimeTypes },
  stt: { supportedMimeTypes: [] },
  text: { supportedMimeTypes: [] },
});

describe('resolveLargeDocRouting (R3.4 — авто-маршрут больших документов в RAG)', () => {
  const req = { config: {} };
  const bigFile = { size: 500 * 1024, originalname: 'contract.pdf' };
  const smallFile = { size: 1024, originalname: 'note.txt' };

  let originalFlag;
  beforeEach(() => {
    originalFlag = process.env.RAG_AUTO_ROUTE_LARGE_DOC;
    checkCapability.mockClear();
    checkCapability.mockResolvedValue(true);
  });
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.RAG_AUTO_ROUTE_LARGE_DOC;
    } else {
      process.env.RAG_AUTO_ROUTE_LARGE_DOC = originalFlag;
    }
  });

  it('флаг выключен → режим без изменений, capability не дёргается', async () => {
    delete process.env.RAG_AUTO_ROUTE_LARGE_DOC;
    const out = await resolveLargeDocRouting({
      req,
      file: bigFile,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out).toBe(EToolResources.context);
    expect(checkCapability).not.toHaveBeenCalled();
  });

  it('флаг вкл + большой документ + file_search включён → file_search', async () => {
    process.env.RAG_AUTO_ROUTE_LARGE_DOC = 'true';
    const out = await resolveLargeDocRouting({
      req,
      file: bigFile,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out).toBe(EToolResources.file_search);
  });

  it('флаг вкл + маленький файл → остаётся context', async () => {
    process.env.RAG_AUTO_ROUTE_LARGE_DOC = 'true';
    const out = await resolveLargeDocRouting({
      req,
      file: smallFile,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out).toBe(EToolResources.context);
  });

  it('флаг вкл + большой, но file_search выключен → остаётся context (документ не теряется)', async () => {
    process.env.RAG_AUTO_ROUTE_LARGE_DOC = 'true';
    checkCapability.mockResolvedValue(false);
    const out = await resolveLargeDocRouting({
      req,
      file: bigFile,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out).toBe(EToolResources.context);
  });

  it('флаг вкл + изображение → не трогаем', async () => {
    process.env.RAG_AUTO_ROUTE_LARGE_DOC = 'true';
    const out = await resolveLargeDocRouting({
      req,
      file: bigFile,
      toolResource: EToolResources.context,
      isImage: true,
    });
    expect(out).toBe(EToolResources.context);
  });

  it('флаг вкл + уже file_search → без изменений', async () => {
    process.env.RAG_AUTO_ROUTE_LARGE_DOC = 'true';
    const out = await resolveLargeDocRouting({
      req,
      file: bigFile,
      toolResource: EToolResources.file_search,
      isImage: false,
    });
    expect(out).toBe(EToolResources.file_search);
  });
});
const setupStoredFileUpload = (result = {}) => {
  const handleFileUpload = jest.fn().mockResolvedValue({
    bytes: 42,
    filename: 'upload.bin',
    filepath: '/uploads/upload.bin',
    ...result,
  });
  getStrategyFunctions.mockReturnValue({ handleFileUpload });
  return handleFileUpload;
};

describe('resolveContentRouting (content-size Auto routing, behind AUTO_ROUTE_BY_TEXT)', () => {
  const baseReq = { user: { id: 'u1' }, config: {} };
  const pdf = { mimetype: 'application/pdf', path: '/tmp/x.pdf', originalname: 'x.pdf' };

  beforeEach(() => {
    checkCapability.mockClear();
    checkCapability.mockResolvedValue(true);
    probePdf.mockClear();
    probePdf.mockResolvedValue({ pageCount: 8, textChars: 300, text: 'probe extracted text' });
    routePdfBySize.mockClear();
    routePdfBySize.mockReturnValue(EToolResources.context);
  });

  it('leaves a non-context resource unchanged and does not probe', async () => {
    const out = await resolveContentRouting({
      req: baseReq,
      file: pdf,
      toolResource: EToolResources.file_search,
      isImage: false,
    });
    expect(out.toolResource).toBe(EToolResources.file_search);
    expect(probePdf).not.toHaveBeenCalled();
  });

  it('leaves images unchanged', async () => {
    const out = await resolveContentRouting({
      req: baseReq,
      file: { mimetype: 'image/png', path: '/tmp/x.png' },
      toolResource: EToolResources.context,
      isImage: true,
    });
    expect(out.toolResource).toBe(EToolResources.context);
    expect(probePdf).not.toHaveBeenCalled();
  });

  it('leaves non-PDF documents on the existing path (no content probe)', async () => {
    const out = await resolveContentRouting({
      req: baseReq,
      file: { mimetype: 'text/plain', path: '/tmp/x.txt' },
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out.toolResource).toBe(EToolResources.context);
    expect(probePdf).not.toHaveBeenCalled();
  });

  it('does not reroute when file_search capability is disabled', async () => {
    checkCapability.mockResolvedValue(false);
    const out = await resolveContentRouting({
      req: baseReq,
      file: pdf,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out.toolResource).toBe(EToolResources.context);
    expect(probePdf).not.toHaveBeenCalled();
  });

  it('probes the PDF and returns the content-based decision (context)', async () => {
    routePdfBySize.mockReturnValue(EToolResources.context);
    const out = await resolveContentRouting({
      req: baseReq,
      file: pdf,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(probePdf).toHaveBeenCalledWith('/tmp/x.pdf');
    expect(routePdfBySize).toHaveBeenCalledWith(8, 300, expect.any(Object));
    expect(out.toolResource).toBe(EToolResources.context);
    // a digital PDF kept in context forwards the probe's text so it isn't parsed twice
    expect(out.pdfText).toBe('probe extracted text');
  });

  it('reroutes a large PDF to file_search per the decision', async () => {
    probePdf.mockResolvedValue({ pageCount: 80, textChars: 250000, text: 'big pdf text' });
    routePdfBySize.mockReturnValue(EToolResources.file_search);
    const out = await resolveContentRouting({
      req: baseReq,
      file: pdf,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out.toolResource).toBe(EToolResources.file_search);
    // headed to RAG: the probe text is not forwarded (RAG embeds its own chunks)
    expect(out.pdfText).toBeUndefined();
  });

  it('D6: routes to file_search (RAG) when the routing probe times out', async () => {
    withTimeout.mockRejectedValueOnce(new Error('PDF routing probe timed out'));
    const out = await resolveContentRouting({
      req: baseReq,
      file: pdf,
      toolResource: EToolResources.context,
      isImage: false,
    });
    expect(out.toolResource).toBe(EToolResources.file_search);
    // the probe never produced a decision, so size-based routing is not consulted
    expect(routePdfBySize).not.toHaveBeenCalled();
    // restore pass-through for the remaining suite
    withTimeout.mockImplementation((promise) => promise);
  });
});

describe('processAgentFileUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRes.status.mockReturnThis();
    mockRes.json.mockReturnValue({});
    checkCapability.mockResolvedValue(true);
    getStrategyFunctions.mockReturnValue({
      handleFileUpload: jest
        .fn()
        .mockResolvedValue({ text: 'extracted text', bytes: 42, filepath: 'doc://result' }),
    });
    mergeFileConfig.mockReturnValue(makeFileConfig());
  });

  describe('OCR strategy selection', () => {
    test.each([
      ['PDF', PDF_MIME],
      ['DOCX', DOCX_MIME],
      ['XLSX', XLSX_MIME],
      ['XLS', XLS_MIME],
      ['ODS', ODS_MIME],
      ['Excel variant (msexcel)', 'application/msexcel'],
      ['Excel variant (x-msexcel)', 'application/x-msexcel'],
    ])('uses document_parser automatically for %s when no OCR is configured', async (_, mime) => {
      mergeFileConfig.mockReturnValue(makeFileConfig());
      const req = makeReq({ mimetype: mime, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('does not check OCR capability when using automatic document_parser fallback', async () => {
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('uses the configured OCR strategy when OCR is set up for the file type', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    test('uses document_parser as default when OCR is configured but no strategy is specified', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { supportedMimeTypes: [PDF_MIME] },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('throws when configured OCR capability is not enabled for the agent', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      checkCapability.mockResolvedValue(false);
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow('OCR capability is not enabled for Agents');
    });

    test('uses document_parser (no capability check) when OCR capability returns false but no OCR config', async () => {
      checkCapability.mockResolvedValue(false);
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('uses document_parser when OCR is configured but the file type is not in OCR supported types', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: DOCX_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
      expect(getStrategyFunctions).not.toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    test('does not invoke any OCR strategy for unsupported MIME types without OCR config', async () => {
      const req = makeReq({ mimetype: 'text/plain', ocrConfig: null });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow('File type text/plain is not supported for text parsing.');

      expect(getStrategyFunctions).not.toHaveBeenCalled();
    });

    test.each([
      ['ODT', ODT_MIME],
      ['ODP', ODP_MIME],
      ['ODG', ODG_MIME],
    ])('routes %s through configured OCR when OCR supports the type', async (_, mime) => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [mime] }));
      const req = makeReq({
        mimetype: mime,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    /* Fork-specific (1ma): RAG_API_URL routes through doc-gateway, whose /text endpoint runs
     * local Tesseract OCR. So when the local document parser yields no text (scanned PDF), we
     * fall back to parseText (RAG /text) to OCR it — full-text mode must work on scans. */
    test('falls back to RAG /text OCR and succeeds when document_parser fails on a scanned PDF', async () => {
      // document_parser (extraction) fails; the storage strategy (that retains the
      // original) still succeeds so the upload can complete.
      getStrategyFunctions.mockImplementation((src) =>
        src === FileSources.document_parser
          ? {
              handleFileUpload: jest.fn().mockRejectedValue(new Error('No text found in document')),
            }
          : {
              handleFileUpload: jest
                .fn()
                .mockResolvedValue({ filepath: '/uploads/scan.pdf', bytes: 100 }),
            },
      );
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      const { parseText } = require('@librechat/api');
      parseText.mockResolvedValueOnce({ text: 'OCR-извлечённый текст договора', bytes: 30 });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).resolves.not.toThrow();

      expect(parseText).toHaveBeenCalled();
    });

    test('throws when document_parser fails and the RAG /text OCR fallback also yields no text', async () => {
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('No text found in document')),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      const { parseText } = require('@librechat/api');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/image-based and requires an OCR service/);

      expect(parseText).toHaveBeenCalled();
    });

    test('D6: a timed-out RAG /text OCR fallback degrades to an honest error, not a hang', async () => {
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('No text found in document')),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      // Simulate the OCR fallback exceeding its timeout: withTimeout rejects,
      // resolveDocumentText swallows it and returns undefined, and the caller raises
      // the same "unable to extract" error instead of blocking on the 300s parseText.
      withTimeout.mockRejectedValueOnce(new Error('RAG /text OCR fallback timed out'));

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/image-based and requires an OCR service/);

      // The scanned-document OCR fallback must use the GENEROUS OCR timeout (120s),
      // not the fast 30s probe/text timeout — a short cap falsely fails real
      // multi-page scans (KFC leases). Assert the timeout arg passed to withTimeout.
      const ocrCall = withTimeout.mock.calls.find((call) =>
        String(call[2] ?? '').includes('OCR fallback timed out'),
      );
      expect(ocrCall).toBeDefined();
      expect(ocrCall[1]).toBe(120000);

      withTimeout.mockImplementation((promise) => promise);
    });

    test('falls back to document_parser when configured OCR fails for a document MIME type', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const failingUpload = jest.fn().mockRejectedValue(new Error('OCR API returned 500'));
      const fallbackUpload = jest
        .fn()
        .mockResolvedValue({ text: 'parsed text', bytes: 11, filepath: 'doc://result' });
      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: failingUpload })
        .mockReturnValueOnce({ handleFileUpload: fallbackUpload });
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).resolves.not.toThrow();

      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('throws when configured OCR, document_parser, and RAG /text fallback all fail', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('failure')),
      });
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      const { parseText } = require('@librechat/api');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/image-based and requires an OCR service/);

      expect(parseText).toHaveBeenCalled();
    });
  });

  /* Fork-specific (1ma): office/pdf/etc. files taken down the full-text `context`
   * path RETAIN the original upload in durable storage (same as file_search /
   * plain attachments) alongside the extracted `text`. The preview route renders
   * office previews on demand from the original, the browser previews PDFs, and
   * Download works — none of which is possible once the original is discarded.
   * The model's `text` is untouched; no deferred render, no `previewText`. */
  describe('retains the original upload (context path)', () => {
    /* getStorageMetadata is mocked as `() => ({})` (its real behavior for
     * non-S3 sources) — filepath/source must land on the record as explicit
     * fields, or preview/download 500 on `undefined.includes`. */

    test('stores the original via the file strategy and keeps model text (docx), no previewText/status', async () => {
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockResolvedValue({
          text: 'plain extracted text',
          bytes: 20,
          filepath: '/uploads/report.docx',
          storageKey: 'uploads/u/report.docx',
        }),
      });
      const req = makeReq({ mimetype: DOCX_MIME });
      req.file.originalname = 'report.docx';

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      // The original was uploaded via the configured (local) strategy.
      expect(getStrategyFunctions).toHaveBeenCalledWith('local');
      const persisted = db.createFile.mock.calls[0][0];
      expect(persisted.source).toBe('local'); // durable original, not FileSources.text
      expect(persisted.filepath).toBe('/uploads/report.docx');
      expect(persisted.text).toBe('plain extracted text'); // model text intact
      expect(persisted).not.toHaveProperty('previewText'); // no deferred render
      expect(persisted).not.toHaveProperty('status');
      expect(db.updateFile).not.toHaveBeenCalled();
    });

    test('stores the original for csv too and keeps the reformatted extract for the model', async () => {
      const { parseText } = require('@librechat/api');
      // doc-gateway reformats the CSV into a labeled extract — NOT the raw file.
      parseText.mockResolvedValueOnce({ text: 'Дата: 2026\nИмя:', bytes: 15 });
      mergeFileConfig.mockReturnValue({
        checkType: (mime, types) => (types ?? []).includes(mime),
        ocr: { supportedMimeTypes: [] },
        stt: { supportedMimeTypes: [] },
        text: { supportedMimeTypes: ['text/csv'] },
      });
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest
          .fn()
          .mockResolvedValue({ filepath: '/uploads/leads.csv', bytes: 8000 }),
      });
      const req = makeReq({ mimetype: 'text/csv' });
      req.file.originalname = 'leads.csv';

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      const persisted = db.createFile.mock.calls[0][0];
      expect(persisted.source).toBe('local');
      expect(persisted.filepath).toBe('/uploads/leads.csv');
      expect(persisted.text).toBe('Дата: 2026\nИмя:'); // model text = reformatted extract, untouched
      expect(persisted).not.toHaveProperty('previewText');
      expect(persisted).not.toHaveProperty('status');
    });
  });

  describe('text size guard', () => {
    test('throws before writing to MongoDB when extracted text exceeds 15MB', async () => {
      const oversizedText = 'x'.repeat(15 * 1024 * 1024 + 1);
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockResolvedValue({
          text: oversizedText,
          bytes: Buffer.byteLength(oversizedText, 'utf8'),
          filepath: 'doc://result',
        }),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      const { createFile } = require('~/models');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/exceeds the 15MB storage limit/);

      expect(createFile).not.toHaveBeenCalled();
    });

    test('succeeds when extracted text is within the 15MB limit', async () => {
      const okText = 'x'.repeat(1024);
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockResolvedValue({
          text: okText,
          bytes: Buffer.byteLength(okText, 'utf8'),
          filepath: 'doc://result',
        }),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).resolves.not.toThrow();
    });
  });

  describe('retention for agent resource uploads', () => {
    test('skips retention metadata for persistent agent context files outside all-data retention when retainAgentFiles is disabled', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: null,
        interfaceConfig: { retentionMode: RetentionMode.TEMPORARY, retainAgentFiles: false },
        body: { conversationId: 'temporary-convo', isTemporary: true },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getAgentFileRetentionExpiry).toHaveBeenCalledWith(
        {
          req,
          messageAttachment: false,
          toolResource: EToolResources.context,
        },
        expect.any(Object),
      );
      expect(getRetentionExpiry).not.toHaveBeenCalled();
      expect(db.createFile).toHaveBeenCalledWith(expect.not.objectContaining({ expiredAt }), true);
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.context,
        }),
      );
    });

    test('skips retention metadata for persistent agent context files outside all-data retention when retainAgentFiles is enabled', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: null,
        interfaceConfig: { retentionMode: RetentionMode.TEMPORARY, retainAgentFiles: true },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getRetentionExpiry).not.toHaveBeenCalled();
      expect(db.createFile).toHaveBeenCalledWith(expect.not.objectContaining({ expiredAt }), true);
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.context,
        }),
      );
    });

    test('applies all-data retention metadata to persistent agent context files when retainAgentFiles is disabled', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      getRetentionExpiry.mockResolvedValueOnce({ expiredAt });
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: null,
        interfaceConfig: { retentionMode: RetentionMode.ALL, retainAgentFiles: false },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getRetentionExpiry).toHaveBeenCalledTimes(1);
      expect(getRetentionExpiry.mock.calls[0][0]).toBe(req);
      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          expiredAt,
          context: FileContext.agents,
        }),
        true,
      );
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.context,
        }),
      );
    });

    test('skips all-data retention metadata for persistent agent context files when retainAgentFiles is enabled', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: null,
        interfaceConfig: { retentionMode: RetentionMode.ALL, retainAgentFiles: true },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getAgentFileRetentionExpiry).toHaveBeenCalledWith(
        {
          req,
          messageAttachment: false,
          toolResource: EToolResources.context,
        },
        expect.any(Object),
      );
      expect(getRetentionExpiry).not.toHaveBeenCalled();
      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          context: FileContext.agents,
        }),
        true,
      );
      expect(db.createFile).toHaveBeenCalledWith(expect.not.objectContaining({ expiredAt }), true);
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.context,
        }),
      );
    });

    test('applies retention metadata to context files uploaded as message attachments', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      getRetentionExpiry.mockResolvedValueOnce({ expiredAt });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: { ...makeMetadata(), message_file: true },
      });

      expect(getRetentionExpiry).toHaveBeenCalledTimes(1);
      expect(getRetentionExpiry.mock.calls[0][0]).toBe(req);
      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          expiredAt,
          context: FileContext.message_attachment,
        }),
        true,
      );
      expect(db.addAgentResourceFile).not.toHaveBeenCalled();
    });

    test('skips retention metadata for persistent agent file-search files outside all-data retention', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      setupStoredFileUpload();
      const req = makeReq({ mimetype: 'text/plain', ocrConfig: null });

      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: { ...makeMetadata(), tool_resource: EToolResources.file_search },
      });

      expect(uploadVectors).toHaveBeenCalled();
      expect(getRetentionExpiry).not.toHaveBeenCalled();
      expect(db.createFile).toHaveBeenCalledWith(expect.not.objectContaining({ expiredAt }), true);
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.file_search,
        }),
      );
    });

    test('applies all-data retention metadata to persistent agent file-search files', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      getRetentionExpiry.mockResolvedValueOnce({ expiredAt });
      setupStoredFileUpload();
      const req = makeReq({
        mimetype: 'text/plain',
        ocrConfig: null,
        interfaceConfig: { retentionMode: RetentionMode.ALL },
      });

      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: { ...makeMetadata(), tool_resource: EToolResources.file_search },
      });

      expect(uploadVectors).toHaveBeenCalled();
      expect(getRetentionExpiry).toHaveBeenCalledTimes(1);
      expect(getRetentionExpiry.mock.calls[0][0]).toBe(req);
      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          expiredAt,
          context: FileContext.agents,
        }),
        true,
      );
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.file_search,
        }),
      );
    });
  });

  /* Phase C / option α regression: the upload must persist its sandbox
   * pointer under `metadata.codeEnvRef` (the post-cutover schema). The
   * legacy `metadata.fileIdentifier` key is silently stripped by mongoose
   * strict mode and downstream readers (`primeFiles`, `getCodeFilesByIds`,
   * `categorizeFileForToolResources`, controller filtering) only check
   * `codeEnvRef`. Storing under the legacy key would orphan the file —
   * priming would skip it on subsequent code-execution turns and the
   * sandbox copy would never re-mount. */
  describe('execute_code uploads persist codeEnvRef metadata', () => {
    const fs = require('fs');
    const { Readable } = require('stream');
    let createReadStreamSpy;

    beforeEach(() => {
      /* `processAgentFileUpload` opens the multer-staged temp file via
       * `fs.createReadStream`. The test fixture path doesn't exist, so
       * stub it to a tiny in-memory stream. */
      createReadStreamSpy = jest
        .spyOn(fs, 'createReadStream')
        .mockImplementation(() => Readable.from(Buffer.from('')));
    });

    afterEach(() => {
      createReadStreamSpy.mockRestore();
    });

    const setupCodeEnvUpload = (uploaded) => {
      /* `processAgentFileUpload` calls `getStrategyFunctions` twice:
       * once with `execute_code` for the codeapi upload, then again with
       * the on-disk strategy (`local`) for the standard storage step that
       * runs in the same flow. Both must return a working
       * `handleFileUpload`. */
      const codeEnvUpload = jest.fn().mockResolvedValue(uploaded);
      const localUpload = jest.fn().mockResolvedValue({
        bytes: 0,
        filename: 'upload.bin',
        filepath: '/uploads/upload.bin',
      });
      getStrategyFunctions.mockImplementation((src) =>
        src === FileSources.execute_code
          ? { handleFileUpload: codeEnvUpload }
          : { handleFileUpload: localUpload, saveBuffer: jest.fn() },
      );
      return codeEnvUpload;
    };

    it('persists kind:user codeEnvRef for chat attachments (messageAttachment=true)', async () => {
      setupCodeEnvUpload({ storage_session_id: 'sess-1', file_id: 'fid-1' });
      const req = makeReq();
      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: {
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
          file_id: 'file-uuid',
          message_file: true,
        },
      });

      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            codeEnvRef: {
              kind: 'user',
              id: 'user-123',
              storage_session_id: 'sess-1',
              file_id: 'fid-1',
            },
          },
        }),
        true,
      );
    });

    it('persists kind:agent codeEnvRef for agent setup files (messageAttachment=false)', async () => {
      setupCodeEnvUpload({ storage_session_id: 'sess-2', file_id: 'fid-2' });
      const req = makeReq();
      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: {
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
          file_id: 'file-uuid',
        },
      });

      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            codeEnvRef: {
              kind: 'agent',
              id: 'agent-abc',
              storage_session_id: 'sess-2',
              file_id: 'fid-2',
            },
          },
        }),
        true,
      );
    });

    it('skips retention metadata for persistent agent execute_code files outside all-data retention', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      setupCodeEnvUpload({ storage_session_id: 'sess-4', file_id: 'fid-4' });
      const req = makeReq();

      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: {
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
          file_id: 'file-uuid',
        },
      });

      expect(getRetentionExpiry).not.toHaveBeenCalled();
      expect(db.createFile).toHaveBeenCalledWith(expect.not.objectContaining({ expiredAt }), true);
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
        }),
      );
    });

    it('applies all-data retention metadata to persistent agent execute_code files', async () => {
      const expiredAt = new Date('2030-01-01T00:00:00.000Z');
      getRetentionExpiry.mockResolvedValueOnce({ expiredAt });
      setupCodeEnvUpload({ storage_session_id: 'sess-5', file_id: 'fid-5' });
      const req = makeReq({ interfaceConfig: { retentionMode: RetentionMode.ALL } });

      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: {
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
          file_id: 'file-uuid',
        },
      });

      expect(getRetentionExpiry).toHaveBeenCalledTimes(1);
      expect(getRetentionExpiry.mock.calls[0][0]).toBe(req);
      expect(db.createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          expiredAt,
          context: FileContext.agents,
          metadata: {
            codeEnvRef: {
              kind: 'agent',
              id: 'agent-abc',
              storage_session_id: 'sess-5',
              file_id: 'fid-5',
            },
          },
        }),
        true,
      );
      expect(db.addAgentResourceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
        }),
      );
    });

    it('does not persist legacy fileIdentifier key (mongoose strict drops it)', async () => {
      setupCodeEnvUpload({ storage_session_id: 'sess-3', file_id: 'fid-3' });
      const req = makeReq();
      await processAgentFileUpload({
        req,
        res: mockRes,
        metadata: {
          agent_id: 'agent-abc',
          tool_resource: EToolResources.execute_code,
          file_id: 'file-uuid',
          message_file: true,
        },
      });

      const persisted = db.createFile.mock.calls[0][0];
      expect(persisted.metadata).not.toHaveProperty('fileIdentifier');
    });
  });
});

describe('D3 — sync file_search embed failure rolls back orphaned storage', () => {
  const makeFsReq = () => ({
    user: { id: 'user-123', tenantId: 'tenant-a' },
    file: {
      path: '/tmp/x.pdf',
      originalname: 'x.pdf',
      filename: 'x.pdf',
      mimetype: PDF_MIME,
      size: 100,
    },
    body: { model: 'gpt-4o' },
    config: { fileConfig: {}, fileStrategy: 'local' },
  });
  const fsMeta = () => ({
    agent_id: 'agent-abc',
    tool_resource: EToolResources.file_search,
    file_id: 'file-uuid-123',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    checkCapability.mockResolvedValue(true);
  });

  it('deletes the stored object and creates no DB record when embedding throws', async () => {
    const deleteFile = jest.fn().mockResolvedValue(undefined);
    const handleFileUpload = jest.fn().mockResolvedValue({
      filepath: '/uploads/user-123/x.pdf',
      storageKey: 'user-123/x.pdf',
      bytes: 100,
      filename: 'x.pdf',
    });
    getStrategyFunctions.mockReturnValue({ handleFileUpload, deleteFile });
    uploadVectors.mockRejectedValueOnce(new Error('embed exploded'));

    await expect(
      processAgentFileUpload({ req: makeFsReq(), res: mockRes, metadata: fsMeta() }),
    ).rejects.toThrow('embed exploded');

    // Rollback removed the orphaned storage object with embedded:false...
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile.mock.calls[0][1]).toMatchObject({
      file_id: 'file-uuid-123',
      embedded: false,
      filepath: '/uploads/user-123/x.pdf',
    });
    // ...and no orphan metadata record was persisted.
    expect(db.createFile).not.toHaveBeenCalled();
  });

  it('does not roll back when embedding succeeds', async () => {
    const deleteFile = jest.fn();
    const handleFileUpload = jest.fn().mockResolvedValue({
      filepath: '/uploads/user-123/x.pdf',
      bytes: 100,
      filename: 'x.pdf',
    });
    getStrategyFunctions.mockReturnValue({ handleFileUpload, deleteFile });
    uploadVectors.mockResolvedValueOnce({
      bytes: 100,
      filename: 'x.pdf',
      filepath: 'vectordb',
      embedded: true,
    });

    await processAgentFileUpload({ req: makeFsReq(), res: mockRes, metadata: fsMeta() });

    expect(deleteFile).not.toHaveBeenCalled();
    expect(db.createFile).toHaveBeenCalledTimes(1);
  });
});

describe('processFileURL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws and skips DB persistence when saveURL returns null', async () => {
    const saveURL = jest.fn().mockResolvedValue(null);
    const getFileURL = jest.fn();
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });

    await expect(
      processFileURL({
        fileStrategy: FileSources.local,
        userId: 'user-123',
        URL: 'https://example.com/image.png',
        fileName: 'image.png',
        basePath: 'images',
        context: FileContext.image_generation,
        tenantId: 'tenant-a',
      }),
    ).rejects.toThrow('Strategy "local" did not save "image.png"');

    expect(getFileURL).not.toHaveBeenCalled();
    expect(db.createFile).not.toHaveBeenCalled();
  });

  it('persists tenantId and strategy-returned filepath metadata', async () => {
    const saveURL = jest.fn().mockResolvedValue({
      filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
      bytes: 512,
      type: 'image/png',
      dimensions: { width: 32, height: 64 },
    });
    const getFileURL = jest.fn();
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });

    await processFileURL({
      fileStrategy: FileSources.cloudfront,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
    });

    expect(getFileURL).not.toHaveBeenCalled();
    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-123',
        filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
        bytes: 512,
        filename: 'image.png',
        source: FileSources.cloudfront,
        type: 'image/png',
        context: FileContext.image_generation,
        tenantId: 'tenant-a',
        width: 32,
        height: 64,
      }),
      true,
    );
  });

  it('applies retention metadata for generated images when retention mode is all', async () => {
    getRetentionExpiry.mockResolvedValueOnce({
      expiredAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const saveURL = jest.fn().mockResolvedValue({
      filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
      bytes: 512,
      type: 'image/png',
    });
    const getFileURL = jest.fn();
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });

    await processFileURL({
      fileStrategy: FileSources.cloudfront,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
      req: {
        user: { id: 'user-123', tenantId: 'tenant-a' },
        body: {},
        config: { interfaceConfig: { retentionMode: 'all', retainAgentFiles: true } },
      },
    });

    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expiredAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
      true,
    );
  });

  it('applies retention metadata for retained non-temporary conversations', async () => {
    const saveURL = jest.fn().mockResolvedValue({
      filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
      bytes: 512,
      type: 'image/png',
    });
    const getFileURL = jest.fn();
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });
    getRetentionExpiry.mockResolvedValueOnce({
      expiredAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    await processFileURL({
      fileStrategy: FileSources.cloudfront,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
      req: {
        user: { id: 'user-123', tenantId: 'tenant-a' },
        body: { conversationId: 'convo-123' },
        config: { interfaceConfig: { retentionMode: RetentionMode.TEMPORARY } },
      },
    });

    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expiredAt: new Date('2030-01-01T00:00:00.000Z'),
      }),
      true,
    );
  });

  it('keeps expired retained conversation files on the parent expiration', async () => {
    const parentExpiredAt = new Date('2020-01-01T00:00:00.000Z');
    const saveURL = jest.fn().mockResolvedValue({
      filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
      bytes: 512,
      type: 'image/png',
    });
    const getFileURL = jest.fn();
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });
    getRetentionExpiry.mockResolvedValueOnce({ expiredAt: parentExpiredAt });

    await processFileURL({
      fileStrategy: FileSources.cloudfront,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
      req: {
        user: { id: 'user-123', tenantId: 'tenant-a' },
        body: { conversationId: 'convo-123' },
        config: { interfaceConfig: { retentionMode: RetentionMode.TEMPORARY } },
      },
    });

    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expiredAt: parentExpiredAt,
      }),
      true,
    );
  });

  it('falls back to getFileURL with user and tenant context when metadata lacks filepath', async () => {
    const saveURL = jest.fn().mockResolvedValue({
      bytes: 256,
      type: 'image/png',
    });
    const getFileURL = jest
      .fn()
      .mockResolvedValue('https://cdn.example.com/t/tenant-a/images/user-123/image.png');
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });

    await processFileURL({
      fileStrategy: FileSources.cloudfront,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
    });

    expect(getFileURL).toHaveBeenCalledWith({
      userId: 'user-123',
      fileName: 'image.png',
      basePath: 'images',
      tenantId: 'tenant-a',
    });
    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: 'https://cdn.example.com/t/tenant-a/images/user-123/image.png',
        tenantId: 'tenant-a',
      }),
      true,
    );
  });

  it('preserves the user path segment for local fallback URLs', async () => {
    const saveURL = jest.fn().mockResolvedValue({
      bytes: 256,
      type: 'image/png',
    });
    const getFileURL = jest.fn().mockResolvedValue('/images/user-123/image.png');
    getStrategyFunctions.mockReturnValue({ saveURL, getFileURL });

    await processFileURL({
      fileStrategy: FileSources.local,
      userId: 'user-123',
      URL: 'https://example.com/image.png',
      fileName: 'image.png',
      basePath: 'images',
      context: FileContext.image_generation,
      tenantId: 'tenant-a',
    });

    expect(getFileURL).toHaveBeenCalledWith({
      userId: 'user-123',
      fileName: 'user-123/image.png',
      basePath: 'images',
      tenantId: 'tenant-a',
    });
    expect(db.createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: '/images/user-123/image.png',
        tenantId: 'tenant-a',
      }),
      true,
    );
  });
});

describe('processDeleteRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('D12: caps concurrent storage deletes at FILE_DELETE_CONCURRENCY', async () => {
    const prev = process.env.FILE_DELETE_CONCURRENCY;
    process.env.FILE_DELETE_CONCURRENCY = '3';
    let active = 0;
    let peak = 0;
    const deleteFile = jest.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    getStrategyFunctions.mockReturnValue({ deleteFile });
    db.deleteFiles.mockResolvedValue({ deletedCount: 10 });

    const files = Array.from({ length: 10 }, (_, i) => ({
      file_id: `f${i}`,
      filepath: `/images/user-123/f${i}.png`,
      source: FileSources.local,
    }));

    const result = await processDeleteRequest({
      req: { body: {}, config: {}, user: { id: 'user-123', tenantId: 'tenant-a' } },
      files,
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // proves deletes actually overlapped, not serialized
    expect(deleteFile).toHaveBeenCalledTimes(10);
    expect(result.deletedFileIds).toHaveLength(10);

    if (prev === undefined) {
      delete process.env.FILE_DELETE_CONCURRENCY;
    } else {
      process.env.FILE_DELETE_CONCURRENCY = prev;
    }
  });

  it('removes metadata when backing storage is already missing', async () => {
    const missingError = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    const deleteFile = jest.fn().mockRejectedValue(missingError);
    getStrategyFunctions.mockReturnValue({ deleteFile });
    db.deleteFiles.mockResolvedValue({ deletedCount: 1 });

    const result = await processDeleteRequest({
      req: {
        body: {},
        config: {},
        user: { id: 'user-123', tenantId: 'tenant-a' },
      },
      files: [
        {
          file_id: 'expired-file',
          filepath: '/images/user-123/expired.png',
          source: FileSources.local,
        },
      ],
    });

    expect(db.deleteFiles).toHaveBeenCalledWith(['expired-file']);
    expect(result).toEqual({ deletedFileIds: ['expired-file'], failedFileIds: [] });
  });

  it('does not treat unrelated not found messages as missing storage', async () => {
    const deleteFile = jest.fn().mockRejectedValue(new Error('Configuration not found'));
    getStrategyFunctions.mockReturnValue({ deleteFile });

    const result = await processDeleteRequest({
      req: {
        body: {},
        config: {},
        user: { id: 'user-123', tenantId: 'tenant-a' },
      },
      files: [
        {
          file_id: 'expired-file',
          filepath: '/images/user-123/expired.png',
          source: FileSources.local,
        },
      ],
    });

    expect(db.deleteFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedFileIds: [], failedFileIds: ['expired-file'] });
  });

  it('throws metadata delete failures after storage deletion succeeds', async () => {
    const deleteFile = jest.fn().mockResolvedValue(undefined);
    const metadataError = new Error('mongo unavailable');
    getStrategyFunctions.mockReturnValue({ deleteFile });
    db.deleteFiles.mockRejectedValue(metadataError);

    await expect(
      processDeleteRequest({
        req: {
          body: {},
          config: {},
          user: { id: 'user-123', tenantId: 'tenant-a' },
        },
        files: [
          {
            file_id: 'expired-file',
            filepath: '/images/user-123/expired.png',
            source: FileSources.local,
          },
        ],
      }),
    ).rejects.toThrow('mongo unavailable');

    expect(db.deleteFiles).toHaveBeenCalledWith(['expired-file']);
    expect(db.removeAgentResourceFilesFromAllAgents).not.toHaveBeenCalled();
  });

  it('deletes vector storage before removing embedded file metadata', async () => {
    const primaryDelete = jest.fn().mockResolvedValue(undefined);
    const vectorDelete = jest.fn().mockResolvedValue(undefined);
    getStrategyFunctions.mockImplementation((source) =>
      source === FileSources.vectordb
        ? { deleteFile: vectorDelete }
        : { deleteFile: primaryDelete },
    );
    db.deleteFiles.mockResolvedValue({ deletedCount: 1 });
    const req = {
      body: {},
      config: {},
      user: { id: 'user-123', tenantId: 'tenant-a' },
    };
    const file = {
      file_id: 'embedded-file',
      filepath: '/uploads/embedded.txt',
      source: FileSources.local,
      embedded: true,
    };

    const result = await processDeleteRequest({ req, files: [file] });

    expect(primaryDelete).toHaveBeenCalledWith(req, file, undefined);
    expect(vectorDelete).toHaveBeenCalledWith(req, file);
    expect(db.deleteFiles).toHaveBeenCalledWith(['embedded-file']);
    expect(result).toEqual({ deletedFileIds: ['embedded-file'], failedFileIds: [] });
  });

  it('keeps embedded file metadata when vector deletion fails', async () => {
    const primaryDelete = jest.fn().mockResolvedValue(undefined);
    const vectorDelete = jest.fn().mockRejectedValue(new Error('rag unavailable'));
    getStrategyFunctions.mockImplementation((source) =>
      source === FileSources.vectordb
        ? { deleteFile: vectorDelete }
        : { deleteFile: primaryDelete },
    );
    const req = {
      body: {},
      config: {},
      user: { id: 'user-123', tenantId: 'tenant-a' },
    };
    const file = {
      file_id: 'embedded-file',
      filepath: '/uploads/embedded.txt',
      source: FileSources.local,
      embedded: true,
    };

    const result = await processDeleteRequest({ req, files: [file] });

    expect(primaryDelete).toHaveBeenCalledWith(req, file, undefined);
    expect(vectorDelete).toHaveBeenCalledWith(req, file);
    expect(db.deleteFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedFileIds: [], failedFileIds: ['embedded-file'] });
  });

  it('does not delete vector storage when primary embedded file deletion fails', async () => {
    const primaryDelete = jest.fn().mockRejectedValue(new Error('permission denied'));
    const vectorDelete = jest.fn().mockResolvedValue(undefined);
    getStrategyFunctions.mockImplementation((source) =>
      source === FileSources.vectordb
        ? { deleteFile: vectorDelete }
        : { deleteFile: primaryDelete },
    );
    const req = {
      body: {},
      config: {},
      user: { id: 'user-123', tenantId: 'tenant-a' },
    };
    const file = {
      file_id: 'embedded-file',
      filepath: '/uploads/embedded.txt',
      source: FileSources.local,
      embedded: true,
    };

    const result = await processDeleteRequest({ req, files: [file] });

    expect(primaryDelete).toHaveBeenCalledWith(req, file, undefined);
    expect(vectorDelete).not.toHaveBeenCalled();
    expect(db.deleteFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedFileIds: [], failedFileIds: ['embedded-file'] });
  });

  it('still deletes vector storage when primary embedded file storage is already missing', async () => {
    const missingError = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    const primaryDelete = jest.fn().mockRejectedValue(missingError);
    const vectorDelete = jest.fn().mockResolvedValue(undefined);
    getStrategyFunctions.mockImplementation((source) =>
      source === FileSources.vectordb
        ? { deleteFile: vectorDelete }
        : { deleteFile: primaryDelete },
    );
    db.deleteFiles.mockResolvedValue({ deletedCount: 1 });
    const req = {
      body: {},
      config: {},
      user: { id: 'user-123', tenantId: 'tenant-a' },
    };
    const file = {
      file_id: 'embedded-file',
      filepath: '/uploads/embedded.txt',
      source: FileSources.local,
      embedded: true,
    };

    const result = await processDeleteRequest({ req, files: [file] });

    expect(primaryDelete).toHaveBeenCalledWith(req, file, undefined);
    expect(vectorDelete).toHaveBeenCalledWith(req, file);
    expect(db.deleteFiles).toHaveBeenCalledWith(['embedded-file']);
    expect(result).toEqual({ deletedFileIds: ['embedded-file'], failedFileIds: [] });
  });

  it('deletes code environment storage before removing code resource file metadata', async () => {
    const primaryDelete = jest.fn().mockResolvedValue(undefined);
    const codeDelete = jest.fn().mockResolvedValue(undefined);
    getStrategyFunctions.mockImplementation((source) =>
      source === FileSources.execute_code
        ? { deleteFile: codeDelete }
        : { deleteFile: primaryDelete },
    );
    db.deleteFiles.mockResolvedValue({ deletedCount: 1 });
    const req = {
      body: {},
      config: {},
      user: { id: 'user-123', tenantId: 'tenant-a' },
    };
    const file = {
      file_id: 'code-resource-file',
      filepath: '/uploads/code-resource.txt',
      source: FileSources.local,
      metadata: {
        codeEnvRef: {
          kind: 'agent',
          id: 'agent-abc',
          storage_session_id: 'sess-1',
          file_id: 'fid-1',
        },
      },
    };

    const result = await processDeleteRequest({ req, files: [file] });

    expect(primaryDelete).toHaveBeenCalledWith(req, file, undefined);
    expect(codeDelete).toHaveBeenCalledWith(req, file);
    expect(db.deleteFiles).toHaveBeenCalledWith(['code-resource-file']);
    expect(result).toEqual({ deletedFileIds: ['code-resource-file'], failedFileIds: [] });
  });
});

describe('sweepExpiredFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates expired file sweeping to the shared package with backend dependencies', async () => {
    const options = {
      appConfig: { paths: { publicPath: '/tmp/public', uploads: '/tmp/uploads' } },
      limit: 1,
    };
    sweepExpiredFilesWithDeps.mockResolvedValue({ scanned: 1, deleted: 1, failed: 0 });

    const result = await sweepExpiredFiles(options);

    expect(sweepExpiredFilesWithDeps).toHaveBeenCalledWith(
      options,
      expect.objectContaining({
        getExpiredFiles: db.getExpiredFiles,
        processDeleteRequest: expect.any(Function),
        logger: expect.objectContaining({
          error: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
        }),
      }),
    );
    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0 });
  });
});

describe('startExpiredFileSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates background sweep startup to the shared package with system context', () => {
    const options = {
      appConfig: { paths: { publicPath: '/tmp/public', uploads: '/tmp/uploads' } },
    };

    const interval = startExpiredFileSweep(options);

    expect(startExpiredFileSweepWithDeps).toHaveBeenCalledWith(
      options,
      expect.objectContaining({
        sweepExpiredFiles: expect.any(Function),
        runAsSystem: expect.any(Function),
        logger: expect.objectContaining({
          error: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
        }),
      }),
    );
    expect(interval).toBe('sweep-interval');
  });
});

describe('resolveUploadPrivacy — маркер приватности файла', () => {
  /* `temporary` пишется в запись файла в момент загрузки — единственный момент, когда temp-статус
   * известен достоверно. Из `expiredAt` его потом не восстановить: под retentionMode ALL дату
   * несёт каждый файл (это срок хранения, не приватность). */
  const reqWith = ({ isTemporary, retentionMode } = {}) => ({
    body: { isTemporary },
    config: { interfaceConfig: retentionMode ? { retentionMode } : {} },
  });

  it('явный флаг temp-чата всегда выигрывает (в т.ч. строкой из multipart)', () => {
    expect(
      resolveUploadPrivacy({ req: reqWith({ isTemporary: true }), retentionExpiry: {} }).temporary,
    ).toBe(true);
    expect(
      resolveUploadPrivacy({ req: reqWith({ isTemporary: 'true' }), retentionExpiry: {} })
        .temporary,
    ).toBe(true);
  });

  it('вне ALL дата ретеншна может прийти только от temp-чата → temp даже без флага', () => {
    expect(
      resolveUploadPrivacy({
        req: reqWith({}),
        retentionExpiry: { expiredAt: new Date() },
      }).temporary,
    ).toBe(true);
  });

  it('под ALL дата универсальна и о приватности не говорит: без флага файл НЕ temp', () => {
    expect(
      resolveUploadPrivacy({
        req: reqWith({ retentionMode: 'all' }),
        retentionExpiry: { expiredAt: new Date() },
      }).temporary,
    ).toBe(false);
  });

  it('обычная загрузка без даты и флага — не temp', () => {
    expect(resolveUploadPrivacy({ req: reqWith({}), retentionExpiry: {} }).temporary).toBe(false);
  });
});
