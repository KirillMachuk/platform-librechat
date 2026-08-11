import type { TArtifactReport } from '../artifactReport';

export const pptxArtifactReportFixture = {
  status: 'ready',
  format: 'pptx',
  sourceFileIds: ['financial-model.xlsx', 'crm-export.csv'],
  previewAssets: [{ filename: 'plan-rosta-2027.pdf', kind: 'pdf', pageCount: 8 }],
  qaChecks: [
    {
      name: 'render',
      status: 'passed',
      message: 'Every slide rendered through LibreOffice',
      details: { slideCount: 8 },
    },
    {
      name: 'native-charts',
      status: 'passed',
      message: 'Found 1 editable native chart',
      details: { requested: 1, found: 1 },
    },
  ],
  issues: [],
  changeLog: [
    { target: 'Presentation', summary: 'Created a Russian decision deck from supplied files' },
  ],
  skillVersion: '3.0.0',
  repairIterations: 0,
  reviewHints: { sourcePanel: true },
} satisfies TArtifactReport;
