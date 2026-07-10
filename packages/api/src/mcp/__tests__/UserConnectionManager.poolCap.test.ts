import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { MCPConnection } from '~/mcp/connection';
import { UserConnectionManager } from '~/mcp/UserConnectionManager';
import { mcpConfig } from '~/mcp/mcpConfig';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getTenantId: jest.fn(),
}));

/** Concrete, test-only subclass exposing the protected pool-cap surface. */
class TestUserConnectionManager extends UserConnectionManager {
  get metrics() {
    return this.connectionSetupMetrics;
  }

  get semaphore() {
    return this.connectionSetupSemaphore;
  }

  seedConnections(userId: string, count: number): void {
    const map = new Map<string, MCPConnection>();
    for (let i = 0; i < count; i++) {
      map.set(`server-${i}`, {} as MCPConnection);
    }
    this.userConnections.set(userId, map);
  }

  checkCapacity(userId: string, serverName: string): void {
    this.assertUserConnectionCapacity(userId, serverName);
  }

  acquireSlot(userId: string, serverName: string, limited: boolean): Promise<() => void> {
    return this.acquireConnectionSetupSlot(userId, serverName, limited);
  }
}

describe('UserConnectionManager — per-user cap', () => {
  const userId = 'user-1';

  it('rejects a new server once the user is at the cached-connection cap', () => {
    const manager = new TestUserConnectionManager();
    manager.seedConnections(userId, mcpConfig.USER_MAX_CACHED_CONNECTIONS);

    expect(() => manager.checkCapacity(userId, 'brand-new-server')).toThrow(McpError);
    expect(manager.metrics.userCapRejections).toBe(1);
  });

  it('allows replacing an already-cached server even at the cap', () => {
    const manager = new TestUserConnectionManager();
    manager.seedConnections(userId, mcpConfig.USER_MAX_CACHED_CONNECTIONS);

    expect(() => manager.checkCapacity(userId, 'server-0')).not.toThrow();
    expect(manager.metrics.userCapRejections).toBe(0);
  });

  it('allows a new server while under the cap', () => {
    const manager = new TestUserConnectionManager();
    manager.seedConnections(userId, 3);

    expect(() => manager.checkCapacity(userId, 'another-server')).not.toThrow();
    expect(manager.metrics.userCapRejections).toBe(0);
  });
});

describe('UserConnectionManager — setup concurrency slot', () => {
  const userId = 'user-1';
  const serverName = 'server-a';

  it('does not consume a slot for excluded (ephemeral/OAuth) connections', async () => {
    const manager = new TestUserConnectionManager();
    const release = await manager.acquireSlot(userId, serverName, false);
    expect(manager.semaphore.active).toBe(0);
    release(); // no-op release is safe
    expect(manager.semaphore.active).toBe(0);
  });

  it('acquires and releases a slot for a limited connection', async () => {
    const manager = new TestUserConnectionManager();
    const release = await manager.acquireSlot(userId, serverName, true);
    expect(manager.semaphore.active).toBe(1);
    release();
    expect(manager.semaphore.active).toBe(0);
  });

  it('rejects with an McpError and records the metric when the queue times out', async () => {
    jest.useFakeTimers();
    try {
      const manager = new TestUserConnectionManager();
      const held: Array<() => void> = [];
      for (let i = 0; i < mcpConfig.MAX_CONCURRENT_CONNECTION_SETUPS; i++) {
        held.push(await manager.semaphore.acquire(1000));
      }
      expect(manager.semaphore.active).toBe(mcpConfig.MAX_CONCURRENT_CONNECTION_SETUPS);

      const rejected = manager.acquireSlot(userId, serverName, true);
      rejected.catch(() => {});
      await jest.advanceTimersByTimeAsync(mcpConfig.CONNECTION_SETUP_QUEUE_TIMEOUT + 100);
      await expect(rejected).rejects.toBeInstanceOf(McpError);

      expect(manager.metrics.setupQueueRejections).toBe(1);
      held.forEach((release) => release());
      expect(manager.semaphore.active).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
