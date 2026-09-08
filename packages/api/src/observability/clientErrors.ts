export type ClientErrorKind = 'boundary' | 'window' | 'promise' | 'unknown';

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack: string;
  path: string;
}

const MAX_MESSAGE = 300;
const MAX_STACK = 1500;
const MAX_PATH = 200;

const KINDS: ReadonlySet<string> = new Set<ClientErrorKind>([
  'boundary',
  'window',
  'promise',
]);

function clip(value: unknown, limit: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Keeps the path and drops everything after it.
 *
 * Query strings here carry conversation and file identifiers, and the
 * reset-password URL carries a token that is live for fifteen minutes; a log file
 * outlives both.
 */
function safePath(value: unknown): string {
  const text = clip(value, MAX_PATH);
  const cut = text.search(/[?#]/);
  return cut === -1 ? text : text.slice(0, cut);
}

/**
 * Turns whatever a broken browser posted into the fixed, clipped shape that may be
 * written to the contour's error log. Returns `null` when there is nothing to record.
 *
 * An allow-list rather than a filter: a report is attacker-controlled input, and the
 * log it lands in is read by an operator and mailed onward by the daily digest.
 */
export function sanitizeClientErrorReport(body: unknown): ClientErrorReport | null {
  if (body == null || typeof body !== 'object') {
    return null;
  }
  const source = body as Partial<Record<keyof ClientErrorReport, unknown>>;
  const message = clip(source.message, MAX_MESSAGE);
  if (!message) {
    return null;
  }
  const kind = typeof source.kind === 'string' && KINDS.has(source.kind) ? source.kind : 'unknown';
  return {
    kind: kind as ClientErrorKind,
    message,
    stack: clip(source.stack, MAX_STACK),
    path: safePath(source.path),
  };
}

/** The `[client]` prefix is the contract with the deploy repo's daily digest, which
 * files these under browser failures instead of the server's own. */
export function formatClientErrorMessage(report: ClientErrorReport): string {
  return `[client] ${report.kind}: ${report.message}`;
}
