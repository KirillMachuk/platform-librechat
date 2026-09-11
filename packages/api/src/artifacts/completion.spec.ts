import type { TArtifactReport } from 'librechat-data-provider';
import {
  ArtifactReadyCompletionError,
  createArtifactCompletionGuard,
  createArtifactCompletionTracker,
  findReadyArtifactCompletion,
  isArtifactReadyCompletionError,
} from './completion';

const readyPptxReport = (): TArtifactReport => ({
  status: 'ready',
  format: 'pptx',
  sourceFileIds: [],
  previewAssets: [
    {
      filename: 'weather.pdf',
      kind: 'pdf',
      delivery: 'requested',
    },
  ],
  qaChecks: [{ name: 'render', status: 'passed', message: 'All slides rendered' }],
  issues: [],
  changeLog: [{ target: 'Presentation', summary: 'Created presentation' }],
  skillVersion: '3.3.3',
  repairIterations: 0,
});

describe('findReadyArtifactCompletion', () => {
  it('accepts a ready editable deck only after every requested delivery was persisted', () => {
    const completion = findReadyArtifactCompletion(new Map([['weather.pptx', readyPptxReport()]]), [
      { filename: 'weather.pptx' },
      { filename: 'weather.pdf' },
    ]);

    expect(completion).toEqual({
      format: 'pptx',
      filenames: ['weather.pptx', 'weather.pdf'],
    });
  });

  it('does not stop the run while a requested PDF is missing', () => {
    const completion = findReadyArtifactCompletion(new Map([['weather.pptx', readyPptxReport()]]), [
      { filename: 'weather.pptx' },
    ]);

    expect(completion).toBeNull();
  });

  it('does not stop the run for a report that still needs review', () => {
    const report = { ...readyPptxReport(), status: 'needs_review' as const };

    expect(
      findReadyArtifactCompletion(new Map([['weather.pptx', report]]), [
        { filename: 'weather.pptx' },
        { filename: 'weather.pdf' },
      ]),
    ).toBeNull();
  });

  it('does not change other artifact formats before their acceptance suites are enabled', () => {
    const report = { ...readyPptxReport(), format: 'pdf' as const, previewAssets: [] };

    expect(
      findReadyArtifactCompletion(new Map([['report.pdf', report]]), [{ filename: 'report.pdf' }]),
    ).toBeNull();
  });
});

describe('artifact completion guard', () => {
  it('waits for persistence and then stops before another model turn', async () => {
    const tracker = createArtifactCompletionTracker();
    let resolveCompletion!: (completion: { format: 'pptx'; filenames: string[] }) => void;
    tracker.track(
      new Promise((resolve) => {
        resolveCompletion = resolve;
      }),
    );

    const guard = createArtifactCompletionGuard(tracker);
    const pending = guard.handle();
    resolveCompletion({ format: 'pptx', filenames: ['weather.pptx', 'weather.pdf'] });

    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: 'ArtifactReadyCompletionError',
        completion: { format: 'pptx', filenames: ['weather.pptx', 'weather.pdf'] },
      }),
    );
  });

  it('leaves the run alone when persistence or QA did not produce a completion', async () => {
    const tracker = createArtifactCompletionTracker();
    tracker.track(Promise.resolve(null));

    await expect(createArtifactCompletionGuard(tracker).handle()).resolves.toBeUndefined();
  });

  it('recognises only the dedicated internal stop signal', () => {
    const error = new ArtifactReadyCompletionError({
      format: 'pptx',
      filenames: ['weather.pptx'],
    });

    expect(isArtifactReadyCompletionError(error)).toBe(true);
    expect(
      isArtifactReadyCompletionError({
        code: 'ARTIFACT_READY_COMPLETION',
        completion: error.completion,
      }),
    ).toBe(false);
    expect(isArtifactReadyCompletionError(new Error('artifact ready'))).toBe(false);
  });
});
