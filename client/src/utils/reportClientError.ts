/**
 * Sends a browser failure to the server, so it stops being invisible.
 *
 * Every error boundary in this app ends at `console.error`, in a browser nobody is
 * watching; a user whose screen fell apart was only ever discovered by asking. This
 * posts the failure to `/api/client-errors`, which writes it into the platform's own
 * error log, where the daily operations digest already looks.
 *
 * Three rules, because the caller is by definition a page that has just broken:
 *
 * 1. **Never throw.** A reporter that fails inside an error handler turns one broken
 *    component into a broken app.
 * 2. **Never block.** Fire and forget; the response is not read.
 * 3. **Never flood.** A render loop can fire the same failure hundreds of times a
 *    second. Identical reports collapse inside a window, and a session has a hard
 *    ceiling — the server's limiter is the second line, not the first.
 */
const ENDPOINT = '/api/client-errors';

/** A session that produces more than this is broken in a way one report already tells us. */
const MAX_PER_SESSION = 10;
/** The same failure repeating inside a minute is one fact, not sixty. */
const DEDUPE_WINDOW_MS = 60_000;

export type ClientErrorKind = 'boundary' | 'window' | 'promise';

let sentCount = 0;
const lastSeen = new Map<string, number>();
let installed = false;

function fingerprint(kind: string, message: string, stack: string): string {
  /* First stack frame only: the rest differs between repetitions of one fault. */
  const frame = stack.split('\n')[1]?.trim() ?? '';
  return `${kind}|${message.slice(0, 120)}|${frame.slice(0, 120)}`;
}

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  }
  if (typeof error === 'string') {
    return { message: error, stack: '' };
  }
  /* Never serialise an unknown object. A rejected promise's reason is routinely an
   * axios error whose `response.data` holds the user's own message, a filename or a
   * slice of the conversation — and this report is written to a log the daily digest
   * mails off the box. Read the two fields an error-shaped object is expected to
   * carry, and nothing else. */
  const shaped = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof shaped?.name === 'string' ? shaped.name : 'UnknownError';
  const detail = typeof shaped?.message === 'string' ? shaped.message : '';
  return { message: detail ? `${name}: ${detail}` : `${name} (no message)`, stack: '' };
}

export function reportClientError(kind: ClientErrorKind, error: unknown): void {
  try {
    if (sentCount >= MAX_PER_SESSION) {
      return;
    }
    const { message, stack } = describe(error);
    if (!message) {
      return;
    }

    const key = fingerprint(kind, message, stack);
    const now = Date.now();
    const previous = lastSeen.get(key);
    if (previous != null && now - previous < DEDUPE_WINDOW_MS) {
      return;
    }
    lastSeen.set(key, now);
    sentCount += 1;

    /* `keepalive` so a report survives the navigation that an error often triggers. */
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        message,
        stack,
        /* Path only. The query string on this app carries conversation and file ids,
         * and the reset-password URL carries a token that is still live. */
        path: window.location?.pathname ?? '',
      }),
      keepalive: true,
      credentials: 'include',
    }).catch(() => {
      /* The report is best effort. A failure here must stay silent — logging it
       * from inside an error handler is how a loop starts. */
    });
  } catch {
    /* See rule 1. */
  }
}

/** Catches what no boundary can: errors outside React, and rejected promises. */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportClientError('window', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportClientError('promise', event.reason);
  });
}

/** Test seam: the module keeps per-session counters that must not leak between tests. */
export function __resetClientErrorReporterForTests(): void {
  sentCount = 0;
  lastSeen.clear();
  installed = false;
}
