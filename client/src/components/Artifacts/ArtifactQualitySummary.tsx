import type { Artifact } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Compact, format-agnostic QA disclosure for authored files. It intentionally
 * reads only the stable artifact-report contract and lets the preview keep the
 * rest of the panel, so future report fields and the ongoing panel redesign do
 * not need to change together.
 */
export default function ArtifactQualitySummary({ artifact }: { artifact: Artifact }) {
  const localize = useLocalize();
  const report = artifact.file?.artifactReport;
  if (!report) {
    return null;
  }

  const isReady = report.status === 'ready';
  const passedChecks = report.qaChecks.filter((check) => check.status === 'passed').length;
  const statusLabel = localize(
    isReady ? 'com_ui_artifact_qa_ready' : 'com_ui_artifact_qa_needs_review',
  );

  return (
    <details
      className={cn(
        'shrink-0 border-b px-4 py-2 text-xs',
        isReady
          ? 'border-border-light bg-surface-primary-alt text-text-secondary'
          : 'border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100',
      )}
      data-testid="artifact-quality-summary"
    >
      <summary className="cursor-pointer select-none font-medium">
        <span className="inline-flex items-center gap-2">
          <span
            className={cn('size-2 rounded-full', isReady ? 'bg-green-600' : 'bg-amber-500')}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
          <span className="font-normal opacity-75">
            {localize('com_ui_artifact_qa_score', {
              passed: String(passedChecks),
              total: String(report.qaChecks.length),
            })}
          </span>
        </span>
      </summary>

      <div className="pan-x mt-2 max-h-64 space-y-3 overflow-y-auto pl-4 pr-1 text-text-secondary">
        <section aria-label={localize('com_ui_artifact_qa_checks')}>
          <h3 className="mb-1 font-medium text-text-primary">
            {localize('com_ui_artifact_qa_checks')}
          </h3>
          <ul className="space-y-1">
            {report.qaChecks.map((check, index) => (
              <li key={`${check.name}-${index}`}>
                <span className="font-medium text-text-primary">{check.name}:</span> {check.message}
              </li>
            ))}
          </ul>
        </section>

        {report.issues.length > 0 && (
          <section aria-label={localize('com_ui_artifact_qa_issues')}>
            <h3 className="mb-1 font-medium text-text-primary">
              {localize('com_ui_artifact_qa_issues')}
            </h3>
            <ul className="space-y-1">
              {report.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </section>
        )}

        {report.changeLog.length > 0 && (
          <section aria-label={localize('com_ui_artifact_qa_changes')}>
            <h3 className="mb-1 font-medium text-text-primary">
              {localize('com_ui_artifact_qa_changes')}
            </h3>
            <ul className="space-y-1">
              {report.changeLog.map((change, index) => (
                <li key={`${change.target}-${index}`}>
                  <span className="font-medium text-text-primary">{change.target}:</span>{' '}
                  {change.summary}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.sourceFileIds.length > 0 && (
          <section aria-label={localize('com_ui_artifact_qa_sources')}>
            <h3 className="mb-1 font-medium text-text-primary">
              {localize('com_ui_artifact_qa_sources')}
            </h3>
            <p className="break-words">{report.sourceFileIds.join(', ')}</p>
          </section>
        )}
      </div>
    </details>
  );
}
