const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

const auditRoleManagement = require('./auditRoleManagement');

function run(req, statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  auditRoleManagement(
    { user: { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' }, ...req },
    res,
    jest.fn(),
  );
  res.emit('finish');
  return mockRecordAudit.mock.calls[0]?.[0];
}

describe('auditRoleManagement', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records role creation with the new role name', () => {
    const event = run({ method: 'POST', route: { path: '/' }, body: { name: 'MANAGER' } });
    expect(event).toMatchObject({ action: 'role.create', targetType: 'role', targetId: 'MANAGER' });
  });

  it('records which permission bits were set, not just that something changed', () => {
    const event = run({
      method: 'PATCH',
      route: { path: '/:name/permissions' },
      params: { name: 'USER' },
      body: { permissions: { WEB_SEARCH: { USE: false }, AGENTS: { USE: true } } },
    });
    expect(event).toMatchObject({ action: 'role.permissions_update', targetId: 'USER' });
    expect(event.metadata.permissions).toBe('WEB_SEARCH.USE=false; AGENTS.USE=true');
  });

  it('truncates an oversized permission summary instead of storing it whole', () => {
    const permissions = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`TYPE_NUMBER_${i}`, { USE: true, CREATE: false }]),
    );
    const event = run({
      method: 'PATCH',
      route: { path: '/:name/permissions' },
      params: { name: 'USER' },
      body: { permissions },
    });
    expect(event.metadata.permissions).toHaveLength(501);
    expect(event.metadata.permissions.endsWith('…')).toBe(true);
  });

  it('separates a rename from a permission change on the same method', () => {
    const event = run({
      method: 'PATCH',
      route: { path: '/:name' },
      params: { name: 'MANAGER' },
      body: { name: 'LEAD' },
    });
    expect(event).toMatchObject({ action: 'role.update', targetId: 'MANAGER' });
    expect(event.metadata).toEqual({ newName: 'LEAD' });
  });

  it('separates removing a member from deleting the role', () => {
    const removal = run({
      method: 'DELETE',
      route: { path: '/:name/members/:userId' },
      params: { name: 'MANAGER', userId: 'u7' },
    });
    expect(removal).toMatchObject({ action: 'role.member_remove', targetId: 'MANAGER' });
    expect(removal.metadata).toEqual({ userId: 'u7' });

    mockRecordAudit.mockClear();
    const deletion = run({
      method: 'DELETE',
      route: { path: '/:name' },
      params: { name: 'MANAGER' },
    });
    expect(deletion).toMatchObject({ action: 'role.delete', targetId: 'MANAGER' });
  });

  it('records the member added to a role', () => {
    const event = run({
      method: 'POST',
      route: { path: '/:name/members' },
      params: { name: 'ADMIN' },
      body: { userId: 'u9' },
    });
    expect(event).toMatchObject({ action: 'role.member_add', targetId: 'ADMIN' });
    expect(event.metadata).toEqual({ userId: 'u9' });
  });

  it('records nothing when the request failed', () => {
    const event = run({ method: 'DELETE', route: { path: '/:name' }, params: { name: 'X' } }, 403);
    expect(event).toBeUndefined();
  });

  it('ignores reads', () => {
    const event = run({ method: 'GET', route: { path: '/:name' }, params: { name: 'USER' } });
    expect(event).toBeUndefined();
  });
});
