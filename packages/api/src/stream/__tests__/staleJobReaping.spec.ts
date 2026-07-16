/**
 * Tests for the stale running-job failsafe that prevents abandoned/hung
 * generations from leaking their content state in memory until the process OOMs.
 *
 * - InMemoryJobStore reaps jobs stuck in "running" past `staleJobTimeout`
 *   (mirrors RedisJobStore's running-job TTL).
 * - GenerationJobManager aborts the in-flight generation when its job is reaped
 *   or replaced, so client/graph references can be garbage collected.
 *
 * @see https://github.com/danny-avila/LibreChat/issues/13391
 */

/** Suppress winston Console transport output (survives jest.resetModules) */
jest.spyOn(console, 'log').mockImplementation();

describe('InMemoryJobStore - stale running-job failsafe', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reaps a running job older than staleJobTimeout', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 1000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    await store.updateJob('s1', { createdAt: Date.now() - 5000 });

    const removed = await store.cleanup();

    expect(removed).toBe(1);
    expect(await store.hasJob('s1')).toBe(false);

    await store.destroy();
  });

  it('does not reap a running job with recent activity even if created long ago', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ staleJobTimeout: 1000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    await store.updateJob('s1', { createdAt: Date.now() - 5000 });
    // Actively streaming: a long but live generation must not be reaped.
    store.recordActivity('s1');

    const removed = await store.cleanup();

    expect(removed).toBe(0);
    expect(await store.hasJob('s1')).toBe(true);

    await store.destroy();
  });

  it('does not reap a replacement job that reuses a stale stream id', async () => {
    jest.useFakeTimers();
    try {
      const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
      const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 1000 });
      await store.initialize();

      await store.createJob('s1', 'u1', 's1');
      store.recordActivity('s1'); // old generation's activity
      await jest.advanceTimersByTimeAsync(5000); // ...goes stale

      // Replacement reuses the same streamId (old job never terminated).
      await store.createJob('s1', 'u1', 's1');
      const removed = await store.cleanup();

      expect(removed).toBe(0); // fresh replacement must not be reaped immediately
      expect(await store.hasJob('s1')).toBe(true);

      await store.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reap a running job within the staleJobTimeout', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ staleJobTimeout: 60000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');

    const removed = await store.cleanup();

    expect(removed).toBe(0);
    expect(await store.hasJob('s1')).toBe(true);

    await store.destroy();
  });

  it('treats staleJobTimeout=0 as disabling the running-job failsafe', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ staleJobTimeout: 0 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    await store.updateJob('s1', { createdAt: Date.now() - 3_600_000 });

    const removed = await store.cleanup();

    expect(removed).toBe(0);
    expect(await store.hasJob('s1')).toBe(true);

    await store.destroy();
  });

  it('removes per-user tracking when reaping a stale running job', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ staleJobTimeout: 1000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    expect(await store.getActiveJobIdsByUser('u1')).toEqual(['s1']);

    await store.updateJob('s1', { createdAt: Date.now() - 5000 });
    await store.cleanup();

    expect(await store.getActiveJobIdsByUser('u1')).toEqual([]);
    expect(await store.getJobCount()).toBe(0);

    await store.destroy();
  });

  it('reaps terminal jobs while leaving fresh running jobs intact', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 60000 });
    await store.initialize();

    await store.createJob('done', 'u1', 'done');
    await store.updateJob('done', { status: 'complete', completedAt: Date.now() });
    await store.createJob('live', 'u1', 'live');

    const removed = await store.cleanup();

    expect(removed).toBe(1);
    expect(await store.hasJob('done')).toBe(false);
    expect(await store.hasJob('live')).toBe(true);

    await store.destroy();
  });
});

describe('InMemoryJobStore - dead heartbeat failsafe', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reaps a running job whose heartbeat went stale, long before the age failsafe', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { STALE_HEARTBEAT_MS } = await import('../interfaces/IJobStore');
    // A one-hour inactivity failsafe proves the reap came from the dead heartbeat, not age.
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 3_600_000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    // A producer that heartbeated, then died: last beat older than the stale window.
    await store.updateJob('s1', { lastHeartbeatAt: Date.now() - STALE_HEARTBEAT_MS - 1000 });

    const removed = await store.cleanup();

    expect(removed).toBe(1);
    expect(await store.hasJob('s1')).toBe(false);

    await store.destroy();
  });

  it('does not reap a running job whose heartbeat is fresh', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 3_600_000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    // Created long ago, but the producer is alive and beating right now.
    await store.updateJob('s1', { createdAt: Date.now() - 5_000_000 });
    await store.recordHeartbeat('s1');

    const removed = await store.cleanup();

    expect(removed).toBe(0);
    expect(await store.hasJob('s1')).toBe(true);

    await store.destroy();
  });

  it('leaves a job that never heartbeats to the existing failsafe (no regression)', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { STALE_HEARTBEAT_MS } = await import('../interfaces/IJobStore');
    // Stale window passed, but no heartbeat was ever recorded and the inactivity failsafe
    // has not: an ordinary (non-heartbeat) job must be untouched by the new path.
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 3_600_000 });
    await store.initialize();

    await store.createJob('s1', 'u1', 's1');
    await store.updateJob('s1', { createdAt: Date.now() - STALE_HEARTBEAT_MS - 1000 });

    const removed = await store.cleanup();

    expect(removed).toBe(0);
    expect(await store.hasJob('s1')).toBe(true);

    await store.destroy();
  });

  it('recordHeartbeat on a gone job is a harmless no-op', async () => {
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const store = new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 1000 });
    await store.initialize();

    // Never created / already reaped: must not throw or resurrect anything.
    await expect(store.recordHeartbeat('ghost')).resolves.toBeUndefined();
    expect(await store.hasJob('ghost')).toBe(false);

    await store.destroy();
  });
});

describe('GenerationJobManager - dead-heartbeat producer notifies its client', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reaps a heartbeat producer that stopped beating and tells the attached client', async () => {
    const { GenerationJobManagerClass } = await import('../GenerationJobManager');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');
    const { STALE_HEARTBEAT_MS } = await import('../interfaces/IJobStore');

    jest.useFakeTimers();
    try {
      const manager = new GenerationJobManagerClass();
      manager.configure({
        // A long inactivity failsafe isolates the dead-heartbeat path as the cause.
        jobStore: new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 3_600_000 }),
        eventTransport: new InMemoryEventTransport(),
        isRedis: false,
      });
      manager.initialize();

      await manager.createJob('conv-hb', 'user-1', 'conv-hb');
      await manager.recordHeartbeat('conv-hb');
      const errors: string[] = [];
      const subscription = await manager.subscribe(
        'conv-hb',
        () => undefined,
        () => undefined,
        (error) => errors.push(error),
      );

      // The producer dies: no more beats. Advance past the stale window + a cleanup tick.
      await jest.advanceTimersByTimeAsync(STALE_HEARTBEAT_MS + 61000);

      expect(errors).toContain('Generation timed out');
      expect(await manager.hasJob('conv-hb')).toBe(false);

      subscription?.unsubscribe();
      await manager.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a live heartbeat producer running across the stale window', async () => {
    const { GenerationJobManagerClass } = await import('../GenerationJobManager');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');
    const { STALE_HEARTBEAT_MS, HEARTBEAT_INTERVAL_MS } = await import('../interfaces/IJobStore');

    jest.useFakeTimers();
    try {
      const manager = new GenerationJobManagerClass();
      manager.configure({
        jobStore: new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 3_600_000 }),
        eventTransport: new InMemoryEventTransport(),
        isRedis: false,
      });
      manager.initialize();

      const job = await manager.createJob('conv-live', 'user-1', 'conv-live');

      // Beat at the production cadence across more than one stale window.
      const beats = Math.ceil((STALE_HEARTBEAT_MS * 2) / HEARTBEAT_INTERVAL_MS);
      for (let i = 0; i < beats; i++) {
        await manager.recordHeartbeat('conv-live');
        await jest.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      }

      expect(job.abortController.signal.aborted).toBe(false);
      expect(await manager.hasJob('conv-live')).toBe(true);

      await manager.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('GenerationJobManager - generation abort on reaping', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('aborts and cleans up a hung running job once the store reaps it', async () => {
    const { GenerationJobManagerClass } = await import('../GenerationJobManager');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');

    jest.useFakeTimers();
    try {
      const manager = new GenerationJobManagerClass();
      manager.configure({
        jobStore: new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 1000 }),
        eventTransport: new InMemoryEventTransport(),
        isRedis: false,
      });
      manager.initialize();

      const job = await manager.createJob('conv-2', 'user-1', 'conv-2');
      expect(await manager.hasJob('conv-2')).toBe(true);
      expect(job.abortController.signal.aborted).toBe(false);

      // Advance past the stale timeout + the 60s cleanup interval.
      await jest.advanceTimersByTimeAsync(61000);

      expect(job.abortController.signal.aborted).toBe(true);
      expect(await manager.hasJob('conv-2')).toBe(false);
      expect(manager.getRuntimeStats().runtimeStateSize).toBe(0);
      expect(manager.getRuntimeStats().eventTransportStreams).toBe(0);

      await manager.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends a terminal error to a still-connected client when its job is reaped', async () => {
    const { GenerationJobManagerClass } = await import('../GenerationJobManager');
    const { InMemoryJobStore } = await import('../implementations/InMemoryJobStore');
    const { InMemoryEventTransport } = await import('../implementations/InMemoryEventTransport');

    jest.useFakeTimers();
    try {
      const manager = new GenerationJobManagerClass();
      manager.configure({
        jobStore: new InMemoryJobStore({ ttlAfterComplete: 0, staleJobTimeout: 1000 }),
        eventTransport: new InMemoryEventTransport(),
        isRedis: false,
      });
      manager.initialize();

      await manager.createJob('conv-3', 'user-1', 'conv-3');
      const errors: string[] = [];
      const subscription = await manager.subscribe(
        'conv-3',
        () => undefined,
        () => undefined,
        (error) => errors.push(error),
      );

      // Hung generation: no chunks emitted; advance past the stale timeout + cleanup tick.
      await jest.advanceTimersByTimeAsync(61000);

      expect(errors).toContain('Generation timed out');
      expect(await manager.hasJob('conv-3')).toBe(false);

      subscription?.unsubscribe();
      await manager.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
