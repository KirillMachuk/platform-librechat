import type { TArtifactFormat, TArtifactReport } from 'librechat-data-provider';

export interface ReadyArtifactCompletion {
  format: TArtifactFormat;
  filenames: string[];
}

export interface PersistedArtifactAttachment {
  filename?: string | null;
}

export interface ArtifactCompletionTracker {
  track: (task: Promise<ReadyArtifactCompletion | null>) => void;
  wait: () => Promise<ReadyArtifactCompletion | null>;
}

export interface ArtifactCompletionGuard {
  handle: (event?: string, data?: object, metadata?: object, graph?: object) => Promise<void>;
}

const isTrustedReadyReport = (report: TArtifactReport): boolean =>
  report.status === 'ready' &&
  report.qaChecks.length > 0 &&
  report.qaChecks.every((check) => check.status !== 'failed') &&
  report.issues.every((issue) => issue.severity !== 'critical');

/**
 * Returns a completion only when the editable artifact and every requested
 * derivative named by its validated report were persisted by the host.
 */
export function findReadyArtifactCompletion(
  reportsByFilename: ReadonlyMap<string, TArtifactReport>,
  attachments: ReadonlyArray<PersistedArtifactAttachment | null>,
): ReadyArtifactCompletion | null {
  const persistedNames = new Set(
    attachments.flatMap((attachment) =>
      typeof attachment?.filename === 'string' ? [attachment.filename] : [],
    ),
  );
  for (const [targetFilename, report] of reportsByFilename) {
    // Enable each format only after its authoring workflow has its own
    // acceptance suite. Today only PPTX has passed that gate.
    if (report.format !== 'pptx' || !isTrustedReadyReport(report)) {
      continue;
    }
    if (!targetFilename.toLowerCase().endsWith(`.${report.format}`)) {
      continue;
    }

    const requestedNames = report.previewAssets.flatMap((asset) =>
      asset.delivery === 'requested' ? [asset.filename] : [],
    );
    const filenames = Array.from(new Set([targetFilename, ...requestedNames]));
    if (!filenames.every((filename) => persistedNames.has(filename))) {
      continue;
    }
    return { format: report.format, filenames };
  }

  return null;
}

/** A private control-flow signal caught by the host before it reaches the user. */
export class ArtifactReadyCompletionError extends Error {
  readonly code = 'ARTIFACT_READY_COMPLETION';
  readonly completion: ReadyArtifactCompletion;

  constructor(completion: ReadyArtifactCompletion) {
    super('A verified artifact was persisted; no further model turn is required');
    this.name = 'ArtifactReadyCompletionError';
    this.completion = completion;
  }
}

export const isArtifactReadyCompletionError = (
  error: unknown,
): error is ArtifactReadyCompletionError => error instanceof ArtifactReadyCompletionError;

/**
 * Coordinates asynchronous host-side file persistence with the next model
 * boundary. Failed persistence resolves to no completion and leaves the agent
 * free to repair or explain the problem.
 */
export function createArtifactCompletionTracker(): ArtifactCompletionTracker {
  let completion: ReadyArtifactCompletion | null = null;
  let pending: Promise<void> = Promise.resolve();

  return {
    track: (task) => {
      const observed = task.catch(() => null);
      pending = Promise.all([pending, observed]).then(([, candidate]) => {
        completion ??= candidate;
      });
    },
    wait: async () => {
      await pending;
      return completion;
    },
  };
}

/** Stops the graph before it can spend another model turn after verified delivery. */
export function createArtifactCompletionGuard(
  tracker: ArtifactCompletionTracker,
): ArtifactCompletionGuard {
  let stopped = false;

  return {
    handle: async () => {
      if (stopped) {
        return;
      }
      const completion = await tracker.wait();
      if (!completion) {
        return;
      }
      stopped = true;
      throw new ArtifactReadyCompletionError(completion);
    },
  };
}
