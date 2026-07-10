/** Why a slot could not be acquired: the wait timed out, or the queue was full. */
export type SemaphoreRejectionReason = 'timeout' | 'queue_full';

/** Raised by {@link Semaphore.acquire} when no slot becomes available in time
 *  or the wait queue is already at capacity. Carries a machine-readable
 *  `reason` so callers can attribute the right metric. */
export class SemaphoreCapacityError extends Error {
  constructor(
    public readonly reason: SemaphoreRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = 'SemaphoreCapacityError';
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * FIFO counting semaphore with a bounded wait queue and per-acquire timeout.
 *
 * `acquire` resolves with a single-use `release` function when a slot is free,
 * or rejects with a {@link SemaphoreCapacityError} when the queue is full
 * (`queue_full`) or the wait exceeds `timeoutMs` (`timeout`). A released permit
 * is handed directly to the next waiter, so the in-use count never exceeds
 * `maxConcurrent` and no permit is lost. Timers are `unref`-ed so a pending
 * waiter never keeps the process alive.
 */
export class Semaphore {
  private inUse = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number = Number.POSITIVE_INFINITY,
  ) {
    if (maxConcurrent < 1) {
      throw new Error('Semaphore maxConcurrent must be >= 1');
    }
  }

  /** Slots currently held. */
  get active(): number {
    return this.inUse;
  }

  /** Callers waiting for a slot. */
  get queued(): number {
    return this.queue.length;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  acquire(timeoutMs: number): Promise<() => void> {
    if (this.inUse < this.maxConcurrent) {
      this.inUse++;
      return Promise.resolve(this.makeRelease());
    }

    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(
        new SemaphoreCapacityError(
          'queue_full',
          `Connection setup wait queue is full (${this.maxQueue}).`,
        ),
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(
          new SemaphoreCapacityError(
            'timeout',
            `Timed out after ${timeoutMs}ms waiting for a connection setup slot.`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      this.queue.push({ resolve, reject, timer });
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        /** Hand the permit straight to the next waiter (no decrement/increment
         *  round-trip) so `inUse` stays a faithful count and the slot is never
         *  momentarily released to a racing acquirer. */
        next.resolve(this.makeRelease());
        return;
      }
      this.inUse--;
    };
  }
}
