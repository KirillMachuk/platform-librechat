const mockAxios = jest.fn();

/* This worktree intentionally has no installed package build. API tests
 * resolve the shared dependency from a sibling worktree, whose dist
 * predates this branch, so provide the new runtime schema at the test
 * boundary. The canonical schema has its own source-level tests. */
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  const { z } = require('zod');
  return {
    ...actual,
    artifactReportSchema: z
      .object({
        status: z.enum(['ready', 'needs_review']),
        format: z.enum(['pptx', 'docx', 'xlsx', 'pdf', 'csv']),
        sourceFileIds: z.array(z.string()),
        previewAssets: z.array(
          z.object({ filename: z.string().min(1), kind: z.enum(['pdf', 'image']) }).passthrough(),
        ),
        qaChecks: z.array(
          z
            .object({
              name: z.string().min(1),
              status: z.enum(['passed', 'warning', 'failed']),
              message: z.string(),
            })
            .passthrough(),
        ),
        issues: z.array(z.object({ code: z.string() }).passthrough()),
        changeLog: z.array(
          z.object({ target: z.string().min(1), summary: z.string().min(1) }).passthrough(),
        ),
        skillVersion: z.string().min(1),
        repairIterations: z.number().int().min(0).max(2),
      })
      .passthrough(),
  };
});

jest.mock('@librechat/api', () => {
  const http = require('http');
  const https = require('https');
  return {
    createAxiosInstance: jest.fn(() => mockAxios),
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
  collectArtifactReports,
  getArtifactReportTargetName,
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

  it('rejects oversized or MongoDB-unsafe report payloads', () => {
    expect(() =>
      parseArtifactReport(Buffer.alloc(ARTIFACT_REPORT_MAX_BYTES + 1), 'board-deck.pptx'),
    ).toThrow('256 KiB');

    const unsafe = Buffer.from(
      JSON.stringify({ ...validReport, reviewHints: { $where: 'malicious' } }),
    );
    expect(() => parseArtifactReport(unsafe, 'board-deck.pptx')).toThrow('unsafe object keys');
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
