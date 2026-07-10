import { Semaphore, SemaphoreCapacityError } from './semaphore';

describe('Semaphore', () => {
  it('grants slots immediately up to the concurrency limit', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire(1000);
    const r2 = await sem.acquire(1000);
    expect(sem.active).toBe(2);
    expect(sem.queued).toBe(0);
    r1();
    r2();
    expect(sem.active).toBe(0);
  });

  it('queues acquirers beyond the limit and releases hand the slot to the next waiter', async () => {
    const sem = new Semaphore(1);
    const first = await sem.acquire(1000);
    expect(sem.active).toBe(1);

    let secondAcquired = false;
    const secondPromise = sem.acquire(1000).then((release) => {
      secondAcquired = true;
      return release;
    });
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    expect(sem.queued).toBe(1);

    first();
    const secondRelease = await secondPromise;
    expect(secondAcquired).toBe(true);
    expect(sem.active).toBe(1);
    expect(sem.queued).toBe(0);
    secondRelease();
    expect(sem.active).toBe(0);
  });

  it('never exceeds the concurrency limit even with a burst of acquirers', async () => {
    const sem = new Semaphore(3);
    let peak = 0;
    const run = async () => {
      const release = await sem.acquire(1000);
      peak = Math.max(peak, sem.active);
      await Promise.resolve();
      release();
    };
    await Promise.all(Array.from({ length: 30 }, run));
    expect(peak).toBeLessThanOrEqual(3);
    expect(sem.active).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('preserves FIFO order for queued waiters', async () => {
    const sem = new Semaphore(1);
    const held = await sem.acquire(1000);
    const order: number[] = [];
    const waiters = [0, 1, 2].map((i) =>
      sem.acquire(1000).then((release) => {
        order.push(i);
        release();
      }),
    );
    held();
    await Promise.all(waiters);
    expect(order).toEqual([0, 1, 2]);
  });

  it('rejects with a timeout reason when no slot frees in time', async () => {
    jest.useFakeTimers();
    try {
      const sem = new Semaphore(1);
      const held = await sem.acquire(1000);
      const pending = sem.acquire(50);
      pending.catch(() => {});
      await jest.advanceTimersByTimeAsync(60);
      await expect(pending).rejects.toMatchObject({
        name: 'SemaphoreCapacityError',
        reason: 'timeout',
      });
      expect(sem.queued).toBe(0);
      held();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects immediately with queue_full when the wait queue is at capacity', async () => {
    const sem = new Semaphore(1, 1);
    const held = await sem.acquire(1000);
    const queued = sem.acquire(1000); // fills the single queue slot
    await Promise.resolve();
    expect(sem.queued).toBe(1);

    await expect(sem.acquire(1000)).rejects.toMatchObject({
      name: 'SemaphoreCapacityError',
      reason: 'queue_full',
    });

    held();
    await queued.then((release) => release());
    expect(sem.active).toBe(0);
  });

  it('a timed-out waiter frees its queue slot so a later acquirer can wait', async () => {
    jest.useFakeTimers();
    try {
      const sem = new Semaphore(1, 1);
      const held = await sem.acquire(1000);
      const timingOut = sem.acquire(50);
      timingOut.catch(() => {});
      await jest.advanceTimersByTimeAsync(60);
      await expect(timingOut).rejects.toBeInstanceOf(SemaphoreCapacityError);
      expect(sem.queued).toBe(0);
      // Queue has room again — this should enqueue, not reject.
      const nextWaiter = sem.acquire(1000);
      await Promise.resolve();
      expect(sem.queued).toBe(1);
      held();
      await nextWaiter.then((release) => release());
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a double release (slot is freed exactly once)', async () => {
    const sem = new Semaphore(2);
    const release = await sem.acquire(1000);
    expect(sem.active).toBe(1);
    release();
    release();
    expect(sem.active).toBe(0);
  });

  it('throws when constructed with an invalid concurrency limit', () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
