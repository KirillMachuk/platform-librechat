const express = require('express');
const request = require('supertest');
const { readFileSync } = require('fs');
const { join } = require('path');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

const auditRoleManagement = require('./auditRoleManagement');
const { ROLE_AUDIT_ACTIONS } = auditRoleManagement;

/**
 * Mounted the way the real router mounts it — per route, through real Express
 * dispatch. The hook resolves on `finish`, so this is also the check that
 * `req.params` and `req.route` still hold the matched route's values by then.
 */
function buildApp(status = 200) {
  const app = express();
  const router = express.Router();
  router.use((req, res, next) => {
    req.user = { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' };
    next();
  });
  const respond = (req, res) => res.status(status).json({ ok: true });

  router.post('/', auditRoleManagement, respond);
  router.patch('/:name', auditRoleManagement, respond);
  router.delete('/:name', auditRoleManagement, respond);
  router.patch('/:name/permissions', auditRoleManagement, respond);
  router.post('/:name/members', auditRoleManagement, respond);
  router.delete('/:name/members/:userId', auditRoleManagement, respond);
  router.get('/:name', auditRoleManagement, respond);

  app.use(express.json());
  app.use('/api/admin/roles', router);
  return app;
}

describe('auditRoleManagement', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records role creation with the new role name', async () => {
    await request(buildApp()).post('/api/admin/roles').send({ name: 'MANAGER' });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.create', targetType: 'role', targetId: 'MANAGER' }),
    );
  });

  it('records which permission bits were set, not just that something changed', async () => {
    await request(buildApp())
      .patch('/api/admin/roles/USER/permissions')
      .send({ permissions: { WEB_SEARCH: { USE: false }, AGENTS: { USE: true } } });

    const event = mockRecordAudit.mock.calls[0][0];
    expect(event).toMatchObject({ action: 'role.permissions_update', targetId: 'USER' });
    expect(event.metadata.permissions).toBe('WEB_SEARCH.USE=false; AGENTS.USE=true');
  });

  it('caps an oversized permission summary instead of storing it whole', async () => {
    const permissions = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`TYPE_NUMBER_${i}`, { USE: true, CREATE: false }]),
    );

    await request(buildApp()).patch('/api/admin/roles/USER/permissions').send({ permissions });

    const summary = mockRecordAudit.mock.calls[0][0].metadata.permissions;
    expect(summary.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('separates a rename from a permission change on the same method', async () => {
    await request(buildApp()).patch('/api/admin/roles/MANAGER').send({ name: 'LEAD' });

    const event = mockRecordAudit.mock.calls[0][0];
    expect(event).toMatchObject({ action: 'role.update', targetId: 'MANAGER' });
    expect(event.metadata).toEqual({ newName: 'LEAD' });
  });

  it('separates removing a member from deleting the role', async () => {
    await request(buildApp()).delete('/api/admin/roles/MANAGER/members/u7');
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: 'role.member_remove',
      targetId: 'MANAGER',
      metadata: { userId: 'u7' },
    });

    mockRecordAudit.mockClear();
    await request(buildApp()).delete('/api/admin/roles/MANAGER');
    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: 'role.delete',
      targetId: 'MANAGER',
    });
  });

  it('records the member added to a role', async () => {
    await request(buildApp()).post('/api/admin/roles/ADMIN/members').send({ userId: 'u9' });

    expect(mockRecordAudit.mock.calls[0][0]).toMatchObject({
      action: 'role.member_add',
      targetId: 'ADMIN',
      metadata: { userId: 'u9' },
    });
  });

  it('records nothing when the request failed', async () => {
    await request(buildApp(403)).delete('/api/admin/roles/MANAGER');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('ignores reads', async () => {
    await request(buildApp()).get('/api/admin/roles/USER');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  /**
   * The resolver keys off route paths. If a path in the router is renamed and
   * this table is not, role changes stop being audited in silence — so the two
   * are compared here rather than trusted.
   */
  it('covers exactly the mutating routes the router guards with it', () => {
    const source = readFileSync(join(__dirname, '../routes/admin/roles.js'), 'utf8');
    const guarded = new Set();
    const routePattern = /router\.(post|patch|delete)\(\s*'([^']+)',([\s\S]*?)\);/g;

    for (const [, method, path, rest] of source.matchAll(routePattern)) {
      if (rest.includes('auditRoleManagement')) {
        guarded.add(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(guarded.size).toBeGreaterThan(0);
    expect([...guarded].sort()).toEqual(Object.keys(ROLE_AUDIT_ACTIONS).sort());
  });
});

/** 500 chars of summary plus the ellipsis the cap appends. */
const MAX_LENGTH = 501;
