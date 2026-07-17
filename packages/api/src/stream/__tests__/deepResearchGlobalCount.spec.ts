/**
 * Unit tests for GenerationJobManager.getActiveDeepResearchCount — the counter behind
 * the global Deep Research admission cap. Exercised against a real InMemoryJobStore (no
 * mocking of the thing under test), which shares the `getRunningJobs` contract with the
 * Redis store the cap runs on in production.
 */
import { InMemoryEventTransport } from '~/stream/implementations/InMemoryEventTransport';
import { InMemoryJobStore } from '~/stream/implementations/InMemoryJobStore';
import { GenerationJobManagerClass } from '~/stream/GenerationJobManager';

jest.spyOn(console, 'log').mockImplementation();

describe('GenerationJobManager.getActiveDeepResearchCount', () => {
  let manager: GenerationJobManagerClass;
  let store: InMemoryJobStore;

  beforeEach(() => {
    store = new InMemoryJobStore({ ttlAfterComplete: 60000 });
    manager = new GenerationJobManagerClass();
    manager.configure({
      jobStore: store,
      eventTransport: new InMemoryEventTransport(),
      isRedis: false,
    });
    manager.initialize();
  });

  afterEach(async () => {
    await manager.destroy();
  });

  /** Create a running job and mark it Deep Research (or not). */
  const seed = async (streamId: string, isDr: boolean) => {
    await store.createJob(streamId, 'user-of-' + streamId, streamId);
    if (isDr) {
      await store.updateJob(streamId, { producerFinalizesOnAbort: true });
    }
  };

  it('counts only Deep Research runs, not ordinary generations', async () => {
    await seed('dr-1', true);
    await seed('dr-2', true);
    await seed('chat-1', false);
    await seed('chat-2', false);

    await expect(manager.getActiveDeepResearchCount()).resolves.toBe(2);
  });

  it('excludes the admitting run itself by streamId', async () => {
    await seed('dr-self', true);
    await seed('dr-other', true);

    await expect(manager.getActiveDeepResearchCount('dr-self')).resolves.toBe(1);
  });

  it('ignores Deep Research jobs that are no longer running', async () => {
    await seed('dr-live', true);
    await seed('dr-done', true);
    await store.updateJob('dr-done', { status: 'complete' });

    await expect(manager.getActiveDeepResearchCount()).resolves.toBe(1);
  });

  it('is zero when nothing is running', async () => {
    await expect(manager.getActiveDeepResearchCount()).resolves.toBe(0);
  });

  it('does not undercount when the excluded id is not a Deep Research run', async () => {
    await seed('dr-1', true);
    await seed('dr-2', true);
    await seed('chat-1', false);

    // Excluding a non-DR id must not shrink the DR count.
    await expect(manager.getActiveDeepResearchCount('chat-1')).resolves.toBe(2);
  });
});
