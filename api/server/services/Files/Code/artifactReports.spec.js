const mockAxios = jest.fn();

jest.mock('@librechat/api', () => {
  const http = require('http');
  const https = require('https');
  return {
    createAxiosInstance: jest.fn(() => mockAxios),
    getBasePath: jest.fn(() => ''),
    getCodeApiAuthHeaders: jest.fn(async () => ({
      Authorization: 'Bearer test-token',
    })),
    buildCodeEnvDownloadQuery: jest.fn(({ kind, id }) => `?kind=${kind}&id=${id}`),
    codeServerHttpAgent: new http.Agent({ keepAlive: false }),
    codeServerHttpsAgent: new https.Agent({ keepAlive: false }),
  };
});

jest.mock('@librechat/agents', () => ({
  getCodeBaseURL: jest.fn(() => 'https://code-api.example.com'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

const { logger } = require('@librechat/data-schemas');
const {
  ARTIFACT_REPORT_MAX_BYTES,
  attachArtifactPreviewFiles,
  collectArtifactReports,
  getArtifactReportTargetName,
  isInternalArtifactPreview,
  parseArtifactReport,
} = require('./artifactReports');

const validReport = {
  status: 'ready',
  format: 'pptx',
  sourceFileIds: ['brief.docx'],
  previewAssets: [{ filename: 'board-deck.pdf', kind: 'pdf', pageCount: 7 }],
  qaChecks: [{ name: 'render', status: 'passed', message: 'Rendered with LibreOffice' }],
  issues: [],
  changeLog: [{ target: 'Presentation', summary: 'Created decision deck' }],
  skillVersion: '3.0.0',
  repairIterations: 1,
  reviewHints: { sourcePanel: true },
};

describe('artifact report sidecars', () => {
  const req = { user: { id: 'user-123' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only recognizes reports targeting a supported artifact format', () => {
    expect(getArtifactReportTargetName('board-deck.pptx.artifact-report.json')).toBe(
      'board-deck.pptx',
    );
    expect(getArtifactReportTargetName('notes.artifact-report.json')).toBeNull();
    expect(getArtifactReportTargetName('board-deck.pptx')).toBeNull();
  });

  it('downloads, validates, and associates a report without dropping unknown fields', async () => {
    mockAxios.mockResolvedValue({
      data: Buffer.from(JSON.stringify(validReport)),
    });

    const reports = await collectArtifactReports({
      req,
      session_id: 'exec-session',
      files: [
        {
          id: 'pptx-id',
          name: 'board-deck.pptx',
          storage_session_id: 'storage-session',
        },
        {
          id: 'report-id',
          name: 'board-deck.pptx.artifact-report.json',
          storage_session_id: 'storage-session',
        },
      ],
    });

    expect(reports.get('board-deck.pptx')).toMatchObject({
      status: 'ready',
      format: 'pptx',
      reviewHints: { sourcePanel: true },
    });
    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://code-api.example.com/download/storage-session/report-id?kind=user&id=user-123',
        maxContentLength: ARTIFACT_REPORT_MAX_BYTES,
      }),
    );
  });

  it('ignores a report whose declared format does not match its target', async () => {
    mockAxios.mockResolvedValue({
      data: Buffer.from(JSON.stringify({ ...validReport, format: 'xlsx' })),
    });

    const reports = await collectArtifactReports({
      req,
      files: [
        { id: 'pptx-id', name: 'board-deck.pptx', session_id: 'session-1' },
        {
          id: 'report-id',
          name: 'board-deck.pptx.artifact-report.json',
          session_id: 'session-1',
        },
      ],
    });

    expect(reports).toHaveProperty('size', 0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match'));
  });

  it('ignores a ready report whose own QA evidence failed', async () => {
    mockAxios.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          ...validReport,
          qaChecks: [{ name: 'render', status: 'failed', message: 'Title is clipped' }],
          issues: [
            {
              code: 'clipped-title',
              severity: 'critical',
              message: 'The title is clipped',
            },
          ],
        }),
      ),
    });

    const reports = await collectArtifactReports({
      req,
      files: [
        { id: 'pptx-id', name: 'board-deck.pptx', session_id: 'session-1' },
        {
          id: 'report-id',
          name: 'board-deck.pptx.artifact-report.json',
          session_id: 'session-1',
        },
      ],
    });

    expect(reports).toHaveProperty('size', 0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Ready reports cannot contain failed QA checks or critical issues'),
    );
  });

  it('rejects oversized or MongoDB-unsafe report payloads', () => {
    expect(() =>
      parseArtifactReport(Buffer.alloc(ARTIFACT_REPORT_MAX_BYTES + 1), 'board-deck.pptx'),
    ).toThrow('256 KiB');

    const unsafe = Buffer.from(
      JSON.stringify({ ...validReport, reviewHints: { $where: 'malicious' } }),
    );
    expect(() => parseArtifactReport(unsafe, 'board-deck.pptx')).toThrow('unsafe object keys');
  });

  it('strips an untrusted preview filepath before validation', () => {
    const report = parseArtifactReport(
      Buffer.from(
        JSON.stringify({
          ...validReport,
          previewAssets: [
            {
              filename: 'board-deck.preview.pdf',
              kind: 'pdf',
              delivery: 'preview_only',
              filepath: 'https://evil.example/deck.pdf',
            },
          ],
        }),
      ),
      'board-deck.pptx',
    );

    expect(report.previewAssets[0]).not.toHaveProperty('filepath');
  });

  it('attaches a server-owned preview path only for an actual output file', () => {
    const reports = new Map([
      [
        'board-deck.pptx',
        {
          ...validReport,
          previewAssets: [
            {
              filename: 'board-deck.preview.pdf',
              kind: 'pdf',
              delivery: 'preview_only',
            },
          ],
        },
      ],
    ]);
    const files = [
      {
        id: '123456789012345678901',
        name: 'board-deck.preview.pdf',
        storage_session_id: 'abcdefghijklmnopqrstu',
      },
    ];

    const enriched = attachArtifactPreviewFiles({ reportsByFilename: reports, files });

    expect(enriched.get('board-deck.pptx').previewAssets[0]).toMatchObject({
      filepath: '/api/files/code/download/abcdefghijklmnopqrstu/123456789012345678901',
    });
    expect(reports.get('board-deck.pptx').previewAssets[0]).not.toHaveProperty('filepath');
  });

  it('does not attach a preview path for an absent, inherited, or malformed output', () => {
    const report = {
      ...validReport,
      previewAssets: [
        {
          filename: 'board-deck.preview.pdf',
          kind: 'pdf',
          delivery: 'preview_only',
        },
      ],
    };
    const reports = new Map([['board-deck.pptx', report]]);

    for (const files of [
      [],
      [
        {
          id: '123456789012345678901',
          name: 'board-deck.preview.pdf',
          storage_session_id: 'short',
        },
      ],
      [
        {
          id: '123456789012345678901',
          name: 'board-deck.preview.pdf',
          storage_session_id: 'abcdefghijklmnopqrstu',
          inherited: true,
        },
      ],
    ]) {
      const enriched = attachArtifactPreviewFiles({ reportsByFilename: reports, files });
      expect(enriched.get('board-deck.pptx').previewAssets[0]).not.toHaveProperty('filepath');
    }
  });

  it('hides only conventional internal previews and keeps requested or arbitrary PDFs visible', () => {
    const internal = new Map([
      [
        'board-deck.pptx',
        {
          ...validReport,
          previewAssets: [
            {
              filename: 'board-deck.preview.pdf',
              kind: 'pdf',
              delivery: 'preview_only',
            },
          ],
        },
      ],
    ]);
    expect(isInternalArtifactPreview('board-deck.preview.pdf', internal)).toBe(true);
    expect(isInternalArtifactPreview('board-deck.pdf', internal)).toBe(false);

    const requested = new Map([
      [
        'board-deck.pptx',
        {
          ...validReport,
          previewAssets: [{ filename: 'board-deck.pdf', kind: 'pdf', delivery: 'requested' }],
        },
      ],
    ]);
    expect(isInternalArtifactPreview('board-deck.pdf', requested)).toBe(false);
    expect(isInternalArtifactPreview('other.preview.pdf', internal)).toBe(false);
  });

  it('hides the legacy same-stem PDF only when delivery metadata is absent', () => {
    const reports = new Map([['board-deck.pptx', validReport]]);

    expect(isInternalArtifactPreview('board-deck.pdf', reports)).toBe(true);
  });

  it('does not associate a valid report when its authored file is absent', async () => {
    mockAxios.mockResolvedValue({
      data: Buffer.from(JSON.stringify(validReport)),
    });

    const reports = await collectArtifactReports({
      req,
      session_id: 'session-1',
      files: [{ id: 'report-id', name: 'board-deck.pptx.artifact-report.json' }],
    });

    expect(reports).toHaveProperty('size', 0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('orphan report'));
  });
});
