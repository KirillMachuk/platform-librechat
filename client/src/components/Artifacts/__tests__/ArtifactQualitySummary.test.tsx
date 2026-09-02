import { fireEvent, render, screen } from '@testing-library/react';
import type { TArtifactReport } from 'librechat-data-provider';
import type { Artifact } from '~/common';
import ArtifactQualitySummary from '../ArtifactQualitySummary';

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, values?: Record<string, string>): string =>
      values ? `${key}:${values.passed}/${values.total}` : key,
}));

const report: TArtifactReport = {
  status: 'ready',
  format: 'docx',
  sourceFileIds: ['project-notes.pdf'],
  previewAssets: [{ filename: 'memo.pdf', kind: 'pdf' }],
  qaChecks: [
    { name: 'reopen', status: 'passed', message: 'DOCX reopens successfully' },
    { name: 'render', status: 'passed', message: 'Every page rendered' },
  ],
  issues: [],
  changeLog: [{ target: 'Document', summary: 'Created a decision memo' }],
  skillVersion: '1.0.0',
  repairIterations: 0,
};

const artifact = (artifactReport?: TArtifactReport): Artifact => ({
  id: 'artifact-1',
  title: 'memo.docx',
  type: 'application/vnd.librechat.docx-preview',
  content: '<html></html>',
  lastUpdateTime: 1,
  file: { file_id: 'file-1', filename: 'memo.docx', artifactReport },
});

describe('ArtifactQualitySummary', () => {
  it('does not add panel chrome to legacy files without a report', () => {
    const { container } = render(<ArtifactQualitySummary artifact={artifact()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a compact verified state and expands traceability details', () => {
    render(<ArtifactQualitySummary artifact={artifact(report)} />);

    const disclosure = screen.getByTestId('artifact-quality-summary');
    expect(disclosure).toHaveTextContent('com_ui_artifact_qa_ready');
    expect(disclosure).toHaveTextContent('com_ui_artifact_qa_score:2/2');

    fireEvent.click(disclosure.querySelector('summary') as HTMLElement);

    expect(disclosure).toHaveAttribute('open');
    expect(disclosure).toHaveTextContent('DOCX reopens successfully');
    expect(disclosure).toHaveTextContent('Created a decision memo');
    expect(disclosure).toHaveTextContent('project-notes.pdf');
  });

  it('surfaces needs-review status and the reported issue', () => {
    const needsReview: TArtifactReport = {
      ...report,
      status: 'needs_review',
      qaChecks: [{ name: 'render', status: 'failed', message: 'Page 2 is clipped' }],
      issues: [{ code: 'page-clipping', severity: 'critical', message: 'Review page 2' }],
    };

    render(<ArtifactQualitySummary artifact={artifact(needsReview)} />);

    const disclosure = screen.getByTestId('artifact-quality-summary');
    expect(disclosure).toHaveTextContent('com_ui_artifact_qa_needs_review');
    expect(disclosure).toHaveTextContent('Review page 2');
  });
});
