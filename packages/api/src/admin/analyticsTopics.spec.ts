import { Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminTopicsDeps } from './analyticsTopics';
import { createAdminTopicsHandlers } from './analyticsTopics';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
  userOverrides: Record<string, unknown> = {},
) {
  const req = {
    params,
    query,
    user: { _id: new Types.ObjectId(), email: 'admin@x.io', role: 'admin', ...userOverrides },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminTopicsDeps> = {}): AdminTopicsDeps {
  return {
    getLatestAnalyticsRun: jest
      .fn()
      .mockResolvedValue({ _id: 'run1', createdAt: new Date('2026-06-15'), conversationCount: 71 }),
    getRunTopics: jest.fn().mockResolvedValue([
      { topicKey: 0, label: 'Договоры', keywords: ['договор'], size: 57, share: 0.8 },
      { topicKey: 1, label: 'Аренда', keywords: ['аренда'], size: 11, share: 0.15 },
    ]),
    getTopicAssignments: jest.fn().mockResolvedValue([{ conversationId: 'c1', topicKey: 0 }]),
    getConversationSummaries: jest.fn().mockResolvedValue([
      {
        conversationId: 'c1',
        title: 'Договор аренды',
        userEmail: 'u@x.io',
        preview: 'изучи договор',
      },
    ]),
    runTopicClustering: jest.fn().mockResolvedValue(undefined),
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createAdminTopicsHandlers', () => {
  describe('getTopics', () => {
    it('returns the run + topic distribution', async () => {
      const deps = createDeps();
      const { getTopics } = createAdminTopicsHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await getTopics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.run).toMatchObject({ runId: 'run1', conversationCount: 71 });
      expect(body.topics).toHaveLength(2);
      expect(body.topics[0]).toMatchObject({ topicKey: 0, label: 'Договоры', size: 57 });
    });

    it('returns an empty result when there is no completed run', async () => {
      const deps = createDeps({ getLatestAnalyticsRun: jest.fn().mockResolvedValue(null) });
      const { getTopics } = createAdminTopicsHandlers(deps);
      const { req, res, json } = createReqRes();

      await getTopics(req, res);

      expect(json.mock.calls[0][0]).toEqual({ run: null, topics: [] });
      expect(deps.getRunTopics).not.toHaveBeenCalled();
    });

    it('scopes to the admin tenant', async () => {
      const deps = createDeps();
      const { getTopics } = createAdminTopicsHandlers(deps);
      const { req, res } = createReqRes({}, {}, { tenantId: 't1' });

      await getTopics(req, res);

      expect(deps.getLatestAnalyticsRun).toHaveBeenCalledWith({ tenantId: 't1' });
    });
  });

  describe('getTopicConversations', () => {
    it('returns example conversations for a topic and audits the access', async () => {
      const deps = createDeps();
      const { getTopicConversations } = createAdminTopicsHandlers(deps);
      const { req, res, status, json } = createReqRes({ topicKey: '0' });

      await getTopicConversations(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].conversations[0]).toMatchObject({
        conversationId: 'c1',
        title: 'Договор аренды',
      });
      expect(deps.recordAudit).toHaveBeenCalledTimes(1);
      expect(deps.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'conversation.search',
          metadata: { topicKey: 0, results: 1 },
        }),
      );
    });

    it('rejects a non-numeric topicKey', async () => {
      const deps = createDeps();
      const { getTopicConversations } = createAdminTopicsHandlers(deps);
      const { req, res, status } = createReqRes({ topicKey: 'abc' });

      await getTopicConversations(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getTopicAssignments).not.toHaveBeenCalled();
    });

    it('reports hasMore via the over-fetch', async () => {
      const deps = createDeps({
        getTopicAssignments: jest
          .fn()
          .mockResolvedValue(
            Array.from({ length: 51 }, (_v, i) => ({ conversationId: `c${i}`, topicKey: 0 })),
          ),
        getConversationSummaries: jest
          .fn()
          .mockResolvedValue(
            Array.from({ length: 50 }, (_v, i) => ({ conversationId: `c${i}`, preview: '' })),
          ),
      });
      const { getTopicConversations } = createAdminTopicsHandlers(deps);
      const { req, res, json } = createReqRes({ topicKey: '0' });

      await getTopicConversations(req, res);

      expect(json.mock.calls[0][0].hasMore).toBe(true);
      // Only the page (not the +1 over-fetch) is hydrated.
      expect((deps.getConversationSummaries as jest.Mock).mock.calls[0][0]).toHaveLength(50);
    });
  });

  describe('runTopics', () => {
    it('503s when clustering is not configured', async () => {
      const deps = createDeps({ runTopicClustering: undefined });
      const { runTopics } = createAdminTopicsHandlers(deps);
      const { req, res, status } = createReqRes();

      await runTopics(req, res);

      expect(status).toHaveBeenCalledWith(503);
    });

    it('starts a recompute (202), audits, and does not await the run', async () => {
      let resolveRun: () => void = () => {};
      const runTopicClustering = jest.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
      );
      const deps = createDeps({ runTopicClustering });
      const { runTopics } = createAdminTopicsHandlers(deps);
      const { req, res, status } = createReqRes({}, {}, { tenantId: 't1' });

      await runTopics(req, res);

      expect(status).toHaveBeenCalledWith(202); // returns before the run finishes
      expect(runTopicClustering).toHaveBeenCalledWith({ tenantId: 't1' });
      expect(deps.recordAudit).toHaveBeenCalledTimes(1);
      resolveRun();
    });
  });
});
