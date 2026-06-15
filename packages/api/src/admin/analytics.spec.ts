import { Types } from 'mongoose';
import type { AnalyticsConversation, AnalyticsInteraction } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminAnalyticsDeps } from './analytics';
import { createAdminAnalyticsHandlers } from './analytics';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function mockInteraction(overrides: Partial<AnalyticsInteraction> = {}): AnalyticsInteraction {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    userId: new Types.ObjectId().toString(),
    userEmail: 'user@example.com',
    userName: 'User',
    model: 'gpt-x',
    endpoint: 'agents',
    agentName: 'Юрист',
    conversationTitle: 'Title',
    preview: 'hello',
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
    ...overrides,
  };
}

function mockConversation(overrides: Partial<AnalyticsConversation> = {}): AnalyticsConversation {
  return {
    conversationId: 'c1',
    title: 'Title',
    model: 'gpt-x',
    agentName: 'Юрист',
    userId: new Types.ObjectId().toString(),
    userEmail: 'user@example.com',
    userName: 'User',
    truncated: false,
    messages: [
      {
        messageId: 'm1',
        parentMessageId: null,
        isCreatedByUser: true,
        sender: 'User',
        text: 'hello',
        model: 'gpt-x',
        endpoint: 'agents',
        createdAt: new Date('2026-03-15T00:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function createReqRes(
  query: Record<string, string | string[]> = {},
  params: Record<string, string> = {},
  userOverrides: Record<string, unknown> = {},
) {
  const req = {
    params,
    query,
    body: {},
    user: {
      _id: new Types.ObjectId(),
      email: 'admin@example.com',
      role: 'admin',
      ...userOverrides,
    },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const send = jest.fn();
  const setHeader = jest.fn();
  const status = jest.fn().mockReturnValue({ json, send });
  const res = { status, json, send, setHeader } as unknown as Response;

  return { req, res, status, json, send, setHeader };
}

function createDeps(overrides: Partial<AdminAnalyticsDeps> = {}): AdminAnalyticsDeps {
  return {
    listInteractions: jest.fn().mockResolvedValue({ interactions: [], hasMore: false }),
    exportInteractions: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    getConversationDetail: jest.fn().mockResolvedValue(null),
    resolveAgentConversationIds: jest.fn().mockResolvedValue([]),
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createAdminAnalyticsHandlers', () => {
  describe('listInteractions', () => {
    it('returns mapped interactions with hasMore and records a search audit', async () => {
      const listInteractions = jest
        .fn()
        .mockResolvedValue({ interactions: [mockInteraction()], hasMore: true });
      const recordAudit = jest.fn();
      const deps = createDeps({ listInteractions, recordAudit });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.hasMore).toBe(true);
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');
      expect(body.interactions[0]).toMatchObject({
        messageId: 'm1',
        userEmail: 'user@example.com',
        preview: 'hello',
        createdAt: '2026-03-15T00:00:00.000Z',
      });

      expect(recordAudit).toHaveBeenCalledTimes(1);
      const event = recordAudit.mock.calls[0][0];
      expect(event).toMatchObject({ action: 'conversation.search', targetType: 'analytics' });
      expect(event.metadata.results).toBe(1);
    });

    it('resolves the agent once and passes conversationIds (not agentId) to the feed', async () => {
      const userId = new Types.ObjectId().toString();
      const resolveAgentConversationIds = jest.fn().mockResolvedValue(['c1', 'c2']);
      const listInteractions = jest.fn().mockResolvedValue({ interactions: [], hasMore: false });
      const deps = createDeps({ resolveAgentConversationIds, listInteractions });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({
        userId,
        agentId: 'agent-9',
        model: 'gpt-x',
        endpoint: 'agents',
        q: 'договор',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      await handlers.listInteractions(req, res);

      expect(resolveAgentConversationIds).toHaveBeenCalledWith('agent-9', undefined);
      const [filter] = listInteractions.mock.calls[0];
      expect(filter.userId).toBe(userId);
      expect(filter.conversationIds).toEqual(['c1', 'c2']);
      expect(filter.agentId).toBeUndefined();
      expect(filter.model).toBe('gpt-x');
      expect(filter.endpoint).toBe('agents');
      expect(filter.search).toBe('договор');
      expect(filter.from).toBeInstanceOf(Date);
      expect(filter.to).toBeInstanceOf(Date);
    });

    it('short-circuits with an audit when the agent has no conversations', async () => {
      const resolveAgentConversationIds = jest.fn().mockResolvedValue([]);
      const listInteractions = jest.fn();
      const recordAudit = jest.fn();
      const deps = createDeps({ resolveAgentConversationIds, listInteractions, recordAudit });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status, json } = createReqRes({ agentId: 'agent-x' });

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0]).toMatchObject({ interactions: [], hasMore: false });
      expect(listInteractions).not.toHaveBeenCalled();
      expect(recordAudit).toHaveBeenCalledTimes(1);
    });

    it('scopes the query to the admin tenant', async () => {
      const listInteractions = jest.fn().mockResolvedValue({ interactions: [], hasMore: false });
      const deps = createDeps({ listInteractions });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({}, {}, { tenantId: 't1' });

      await handlers.listInteractions(req, res);

      expect(listInteractions.mock.calls[0][0].tenantId).toBe('t1');
    });

    it('caps an overly long search term', async () => {
      const listInteractions = jest.fn().mockResolvedValue({ interactions: [], hasMore: false });
      const deps = createDeps({ listInteractions });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({ q: 'x'.repeat(500) });

      await handlers.listInteractions(req, res);

      expect(listInteractions.mock.calls[0][0].search.length).toBe(200);
    });

    it('rejects an offset beyond the cap', async () => {
      const deps = createDeps();
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ offset: '200000' });

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listInteractions).not.toHaveBeenCalled();
    });

    it('rejects an invalid userId', async () => {
      const deps = createDeps();
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ userId: 'not-an-id' });

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listInteractions).not.toHaveBeenCalled();
    });

    it('rejects an invalid date', async () => {
      const deps = createDeps();
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ from: 'nope' });

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listInteractions).not.toHaveBeenCalled();
    });

    it('returns 500 when a dependency throws', async () => {
      const deps = createDeps({
        listInteractions: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes();

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });

    it('returns 503 when the query times out (maxTimeMS expired)', async () => {
      const deps = createDeps({
        listInteractions: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('timeout'), { code: 50 })),
      });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes();

      await handlers.listInteractions(req, res);

      expect(status).toHaveBeenCalledWith(503);
    });
  });

  describe('listInteractions — MeiliSearch backend', () => {
    function meiliDeps(overrides: Partial<AdminAnalyticsDeps> = {}) {
      return createDeps({
        useMeiliSearch: true,
        searchInteractionIds: jest.fn().mockResolvedValue({ ids: ['m1'], hasMore: false }),
        listInteractionsByIds: jest.fn().mockResolvedValue([mockInteraction()]),
        listInteractions: jest.fn().mockResolvedValue({ interactions: [], hasMore: false }),
        ...overrides,
      });
    }

    it('serves an eligible text search via Meili (ranked ids → hydrate), not Mongo', async () => {
      const searchInteractionIds = jest
        .fn()
        .mockResolvedValue({ ids: ['m2', 'm1'], hasMore: true });
      const listInteractionsByIds = jest.fn().mockResolvedValue([mockInteraction()]);
      const deps = meiliDeps({ searchInteractionIds, listInteractionsByIds });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status, json } = createReqRes({ q: 'договор' });

      await handlers.listInteractions(req, res);

      expect(searchInteractionIds).toHaveBeenCalledTimes(1);
      const [filter, opts] = searchInteractionIds.mock.calls[0];
      expect(filter.search).toBe('договор');
      expect(opts).toMatchObject({ offset: 0 });
      expect(listInteractionsByIds).toHaveBeenCalledWith(
        ['m2', 'm1'],
        expect.objectContaining({ search: 'договор' }),
      );
      expect(deps.listInteractions).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].hasMore).toBe(true);
    });

    it('falls back to Mongo when Meili returns null (unavailable / no tenant)', async () => {
      const searchInteractionIds = jest.fn().mockResolvedValue(null);
      const deps = meiliDeps({ searchInteractionIds });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ q: 'договор' });

      await handlers.listInteractions(req, res);

      expect(searchInteractionIds).toHaveBeenCalledTimes(1);
      expect(deps.listInteractions).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(200);
    });

    it('falls back to Mongo (not 500) when Meili throws', async () => {
      const searchInteractionIds = jest.fn().mockRejectedValue(new Error('meili down'));
      const deps = meiliDeps({ searchInteractionIds });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ q: 'договор' });

      await handlers.listInteractions(req, res);

      expect(deps.listInteractions).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(200);
    });

    it('uses Mongo for filters Meili cannot serve (model/endpoint present)', async () => {
      const searchInteractionIds = jest.fn();
      const deps = meiliDeps({ searchInteractionIds });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({ q: 'договор', model: 'gpt-x' });

      await handlers.listInteractions(req, res);

      expect(searchInteractionIds).not.toHaveBeenCalled();
      expect(deps.listInteractions).toHaveBeenCalledTimes(1);
    });

    it('uses Mongo when there is no search term (plain chronological feed)', async () => {
      const searchInteractionIds = jest.fn();
      const deps = meiliDeps({ searchInteractionIds });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({});

      await handlers.listInteractions(req, res);

      expect(searchInteractionIds).not.toHaveBeenCalled();
      expect(deps.listInteractions).toHaveBeenCalledTimes(1);
    });
  });

  describe('export', () => {
    it('returns CSV (BOM + header rows) and records a conversation.export audit', async () => {
      const exportInteractions = jest.fn().mockResolvedValue({
        rows: [
          {
            createdAt: new Date('2026-03-15T00:00:00.000Z'),
            userId: 'u1',
            userEmail: 'alice@x.io',
            userName: 'Alice',
            model: 'gpt-x',
            agentName: 'Юрист',
            text: 'привет, мир',
          },
        ],
        truncated: false,
      });
      const recordAudit = jest.fn();
      const deps = createDeps({ exportInteractions, recordAudit });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status, send, setHeader } = createReqRes();

      await handlers.export(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(setHeader).toHaveBeenCalledWith('X-Export-Truncated', 'false');
      const csv = send.mock.calls[0][0] as string;
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('Время,Сотрудник,Email,Модель/агент,Запрос');
      expect(csv).toContain('"привет, мир"');
      expect(csv).toContain('агент: Юрист');
      expect(recordAudit).toHaveBeenCalledTimes(1);
      expect(recordAudit.mock.calls[0][0].action).toBe('conversation.export');
      expect(recordAudit.mock.calls[0][0].metadata.results).toBe(1);
      expect(recordAudit.mock.calls[0][0].metadata.truncated).toBe(false);
    });

    it('neutralizes spreadsheet formula injection in employee-controlled cells', async () => {
      const exportInteractions = jest.fn().mockResolvedValue({
        rows: [
          {
            createdAt: new Date('2026-03-15T00:00:00.000Z'),
            userId: 'u1',
            userEmail: 'e@x.io',
            userName: '=cmd|calc',
            model: 'gpt-x',
            agentName: undefined,
            text: '=HYPERLINK("http://evil","x")',
          },
          {
            createdAt: new Date('2026-03-15T00:00:00.000Z'),
            userId: 'u2',
            userEmail: 'e2@x.io',
            userName: 'Bob',
            model: 'gpt-x',
            agentName: undefined,
            text: '+1+1',
          },
        ],
        truncated: false,
      });
      const deps = createDeps({ exportInteractions });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, send } = createReqRes();

      await handlers.export(req, res);

      const csv = send.mock.calls[0][0] as string;
      // Formula triggers are prefixed with a single quote so a spreadsheet treats them as text.
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).toContain("'=cmd|calc");
      expect(csv).toContain("'+1+1");
      // No formula reaches a cell boundary (start-of-cell after a comma) un-neutralized.
      expect(csv).not.toContain(',=HYPERLINK');
      expect(csv).not.toContain(',=cmd');
      expect(csv).not.toContain(',+1+1');
    });

    it('flags a truncated export via header and audit metadata', async () => {
      const exportInteractions = jest.fn().mockResolvedValue({ rows: [], truncated: true });
      const recordAudit = jest.fn();
      const deps = createDeps({ exportInteractions, recordAudit });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, setHeader } = createReqRes();

      await handlers.export(req, res);

      expect(setHeader).toHaveBeenCalledWith('X-Export-Truncated', 'true');
      expect(recordAudit.mock.calls[0][0].metadata.truncated).toBe(true);
    });

    it('rejects an invalid userId before exporting', async () => {
      const deps = createDeps();
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ userId: 'not-an-id' });

      await handlers.export(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.exportInteractions).not.toHaveBeenCalled();
    });
  });

  describe('getConversation', () => {
    it('returns the conversation (incl. truncated) and records a read audit event', async () => {
      const conversation = mockConversation();
      const getConversationDetail = jest.fn().mockResolvedValue(conversation);
      const recordAudit = jest.fn();
      const deps = createDeps({ getConversationDetail, recordAudit });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status, json } = createReqRes({}, { conversationId: 'c1' });

      await handlers.getConversation(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.conversation.conversationId).toBe('c1');
      expect(body.conversation.truncated).toBe(false);
      expect(body.conversation.messages[0].createdAt).toBe('2026-03-15T00:00:00.000Z');

      expect(recordAudit).toHaveBeenCalledTimes(1);
      const event = recordAudit.mock.calls[0][0];
      expect(event).toMatchObject({
        action: 'conversation.read',
        targetType: 'conversation',
        targetId: 'c1',
        conversationId: 'c1',
      });
      expect(event.metadata.viewedUser).toBe(conversation.userId);
    });

    it('scopes the conversation lookup to the admin tenant', async () => {
      const getConversationDetail = jest.fn().mockResolvedValue(mockConversation());
      const deps = createDeps({ getConversationDetail });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res } = createReqRes({}, { conversationId: 'c1' }, { tenantId: 't1' });

      await handlers.getConversation(req, res);

      expect(getConversationDetail).toHaveBeenCalledWith('c1', 't1');
    });

    it('returns 404 and records nothing when the conversation is missing', async () => {
      const recordAudit = jest.fn();
      const deps = createDeps({
        getConversationDetail: jest.fn().mockResolvedValue(null),
        recordAudit,
      });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({}, { conversationId: 'missing' });

      await handlers.getConversation(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it('returns 500 when the lookup throws', async () => {
      const deps = createDeps({
        getConversationDetail: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({}, { conversationId: 'c1' });

      await handlers.getConversation(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });

    it('returns 503 when the lookup times out (maxTimeMS expired)', async () => {
      const deps = createDeps({
        getConversationDetail: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('timeout'), { code: 50 })),
      });
      const handlers = createAdminAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({}, { conversationId: 'c1' });

      await handlers.getConversation(req, res);

      expect(status).toHaveBeenCalledWith(503);
    });
  });
});
