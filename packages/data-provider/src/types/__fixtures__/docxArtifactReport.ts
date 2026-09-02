import type { TArtifactReport } from '../artifactReport';

export const docxArtifactReportFixture = {
  status: 'ready',
  format: 'docx',
  sourceFileIds: ['project-notes.pdf'],
  previewAssets: [{ filename: 'pilot-decision.pdf', kind: 'pdf', pageCount: 3 }],
  qaChecks: [
    {
      name: 'reopen',
      status: 'passed',
      message: 'DOCX reopens successfully',
    },
    {
      name: 'render',
      status: 'passed',
      message: 'Every page rendered through LibreOffice',
      details: { pageCount: 3 },
    },
  ],
  issues: [],
  changeLog: [{ target: 'Document', summary: 'Created a Russian decision memo' }],
  skillVersion: '1.0.0',
  repairIterations: 0,
  reviewHints: { sourcePanel: true },
} satisfies TArtifactReport;
