import type { AnonymizerConnection } from './sovereign';
import { startSovereignSession, sovereignPassthroughHeaders } from './sovereign';

interface RecordedCall {
  url: string;
  body: unknown;
  authorization: string | null;
  signal: AbortSignal | null | undefined;
}

/** Minimal fetch double: records each call and replies from a per-path handler. */
function makeFetch(
  handler: (path: string, call: RecordedCall) => { ok?: boolean; status?: number; body?: unknown },
) {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: RecordedCall = {
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      authorization: headers.Authorization ?? null,
      signal: init?.signal,
    };
    calls.push(call);
    const path = url.slice(url.indexOf('/v1/'));
    const res = handler(path, call);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const CONNECTION: AnonymizerConnection = {
  baseURL: 'http://anon.internal:8000/v1',
  apiKey: 'sk-client',
};
const TOKEN = 'passthrough-secret';

describe('sovereignPassthroughHeaders', () => {
  it('asks the anonymizer to pass the model call through unmasked', () => {
    expect(sovereignPassthroughHeaders('tok')).toEqual({
      'X-Anon-Passthrough': '1',
      'X-Anon-Passthrough-Token': 'tok',
    });
  });
});

describe('startSovereignSession — feature gate (→ legacy full-masking when null)', () => {
  it('returns null with no passthrough token (feature off)', async () => {
    const { fn, calls } = makeFetch(() => ({ body: { masked: 'x' } }));
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'run1',
      passthroughToken: '',
      question: 'q',
      fetchImpl: fn,
    });
    expect(session).toBeNull();
    expect(calls).toHaveLength(0); // never touches the anonymizer when off
  });

  it('returns null when the connection is missing or incomplete', async () => {
    const { fn } = makeFetch(() => ({ body: { masked: 'x' } }));
    for (const connection of [
      null,
      undefined,
      { baseURL: '', apiKey: 'k' },
      { baseURL: 'u', apiKey: '' },
    ]) {
      const session = await startSovereignSession({
        connection,
        runId: 'run1',
        passthroughToken: TOKEN,
        question: 'q',
        fetchImpl: fn,
      });
      expect(session).toBeNull();
    }
  });

  it('returns null when runId is empty', async () => {
    const { fn } = makeFetch(() => ({ body: { masked: 'x' } }));
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: '',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    expect(session).toBeNull();
  });
});

describe('startSovereignSession — question masking', () => {
  it('masks the question via /v1/detect (Bearer auth, run_id body) and returns the session', async () => {
    const { fn, calls } = makeFetch((path) => {
      expect(path).toBe('/v1/detect');
      return { body: { level: 'reversible', reversible: true, masked: 'Клиент [PERSON_1]' } };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'run-42',
      passthroughToken: TOKEN,
      question: 'Проверь клиента Иванова Ивана',
      fetchImpl: fn,
    });
    expect(session).not.toBeNull();
    expect(session?.maskedQuestion).toBe('Клиент [PERSON_1]');
    expect(session?.passthroughHeaders).toEqual({
      'X-Anon-Passthrough': '1',
      'X-Anon-Passthrough-Token': TOKEN,
    });
    expect(calls[0].url).toBe('http://anon.internal:8000/v1/detect');
    expect(calls[0].body).toEqual({ run_id: 'run-42', text: 'Проверь клиента Иванова Ивана' });
    expect(calls[0].authorization).toBe('Bearer sk-client');
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('normalizes a trailing slash on baseURL (no double slash)', async () => {
    const { fn, calls } = makeFetch(() => ({ body: { masked: 'm' } }));
    await startSovereignSession({
      connection: { baseURL: 'http://anon.internal:8000/v1/', apiKey: 'k' },
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    expect(calls[0].url).toBe('http://anon.internal:8000/v1/detect');
  });

  it('degrades to legacy (null) and warns when detect returns non-2xx', async () => {
    const warn = jest.fn();
    const { fn } = makeFetch(() => ({ ok: false, status: 503, body: { error: 'busy' } }));
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
      logger: { warn, error: jest.fn() },
    });
    expect(session).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('degrades to legacy (null) when detect returns no masked string', async () => {
    const { fn } = makeFetch(() => ({ body: { level: 'off' } }));
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    expect(session).toBeNull();
  });
});

describe('SovereignSession.maskContent (file_search — user documents)', () => {
  it('masks document text into the same run map', async () => {
    const { fn, calls } = makeFetch(() => ({ body: { masked: 'Договор с [ORG_1]' } }));
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'run-9',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    const masked = await session!.maskContent('Договор с ООО Ромашка');
    expect(masked).toBe('Договор с [ORG_1]');
    // second call is the file_search mask, reusing the SAME run_id (accumulating map)
    expect(calls[1].url).toBe('http://anon.internal:8000/v1/detect');
    expect(calls[1].body).toEqual({ run_id: 'run-9', text: 'Договор с ООО Ромашка' });
  });

  it('REJECTS on failure so the caller drops the chunk (never egresses raw PII)', async () => {
    let first = true;
    const { fn } = makeFetch(() => {
      if (first) {
        first = false;
        return { body: { masked: 'ok' } }; // question mask succeeds
      }
      return { ok: false, status: 500, body: {} }; // file_search mask fails
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    await expect(session!.maskContent('raw doc PII')).rejects.toThrow();
  });
});

describe('SovereignSession.restore (final report)', () => {
  it('restores placeholders to real PII via /v1/restore', async () => {
    const { fn, calls } = makeFetch((path) => {
      if (path === '/v1/detect') {
        return { body: { masked: 'm' } };
      }
      return { body: { restored: 'Отчёт по Иванову Ивану', run_found: true } };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'run-r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    const restored = await session!.restore('Отчёт по [PERSON_1]');
    expect(restored).toBe('Отчёт по Иванову Ивану');
    const restoreCall = calls.find((c) => c.url.endsWith('/restore'));
    expect(restoreCall?.body).toEqual({ run_id: 'run-r', text: 'Отчёт по [PERSON_1]' });
  });

  it('NEVER throws: returns the input text (with placeholders) and logs on failure', async () => {
    const error = jest.fn();
    let first = true;
    const { fn } = makeFetch(() => {
      if (first) {
        first = false;
        return { body: { masked: 'm' } };
      }
      return { ok: false, status: 500, body: {} };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
      logger: { warn: jest.fn(), error },
    });
    const restored = await session!.restore('report with [PERSON_1]');
    expect(restored).toBe('report with [PERSON_1]');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('does NOT use the run abort signal — a partial report still de-masks after Stop', async () => {
    const controller = new AbortController();
    const { fn, calls } = makeFetch((path) => {
      if (path === '/v1/detect') {
        return { body: { masked: 'm' } };
      }
      return { body: { restored: 'clean', run_found: true } };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      signal: controller.signal,
      fetchImpl: fn,
    });
    controller.abort(); // user pressed Stop AFTER research, before restore
    const restored = await session!.restore('partial [PERSON_1]');
    expect(restored).toBe('clean');
    const restoreCall = calls.find((c) => c.url.endsWith('/restore'));
    expect(restoreCall?.signal?.aborted).toBe(false); // restore's signal is timeout-only, not the aborted run signal
  });
});

describe('SovereignSession.drop (free the server-side map)', () => {
  it('posts /v1/run/drop with the run_id', async () => {
    const { fn, calls } = makeFetch((path) => {
      if (path === '/v1/detect') {
        return { body: { masked: 'm' } };
      }
      return { body: { dropped: true } };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'run-drop',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
    });
    await session!.drop();
    const dropCall = calls.find((c) => c.url.endsWith('/run/drop'));
    expect(dropCall?.body).toEqual({ run_id: 'run-drop' });
  });

  it('swallows errors (map will TTL-expire) and warns', async () => {
    const warn = jest.fn();
    let first = true;
    const { fn } = makeFetch(() => {
      if (first) {
        first = false;
        return { body: { masked: 'm' } };
      }
      return { ok: false, status: 500, body: {} };
    });
    const session = await startSovereignSession({
      connection: CONNECTION,
      runId: 'r',
      passthroughToken: TOKEN,
      question: 'q',
      fetchImpl: fn,
      logger: { warn, error: jest.fn() },
    });
    await expect(session!.drop()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
