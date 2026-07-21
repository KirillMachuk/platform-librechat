import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import type { IUser, UserDeleteResult } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminUsersDeps } from './users';
import { createAdminUsersHandlers } from './users';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const validUserId = new Types.ObjectId().toString();

function mockUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    name: 'Test User',
    username: 'testuser',
    email: 'test@example.com',
    avatar: 'https://example.com/avatar.png',
    role: 'USER',
    provider: 'local',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    ...overrides,
  } as IUser;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    query?: Record<string, string | string[]>;
    body?: Record<string, unknown>;
    user?: { _id?: Types.ObjectId; id?: string; role?: string; tenantId?: string };
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user: overrides.user ?? { _id: new Types.ObjectId(), role: 'admin' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminUsersDeps> = {}): AdminUsersDeps {
  return {
    findUsers: jest.fn().mockResolvedValue([]),
    countUsers: jest.fn().mockResolvedValue(0),
    findUser: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      email: 'new@example.com',
      name: 'New User',
      username: 'new@example.com',
      role: 'USER',
      provider: 'local',
    }),
    updateUser: jest.fn().mockResolvedValue(mockUser()),
    hashPassword: jest.fn().mockResolvedValue('hashed-password'),
    getBalanceConfig: jest.fn().mockResolvedValue(undefined),
    deleteUserById: jest
      .fn()
      .mockResolvedValue({ deletedCount: 1, message: 'User was deleted successfully.' }),
    deleteConfig: jest.fn().mockResolvedValue(null),
    deleteAclEntries: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createAdminUsersHandlers', () => {
  describe('listUsers', () => {
    it('returns paginated users with total count', async () => {
      const users = [
        mockUser({ _id: new Types.ObjectId(validUserId) }),
        mockUser({ name: 'Other' }),
      ];
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue(users),
        countUsers: jest.fn().mockResolvedValue(2),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const response = json.mock.calls[0][0];
      expect(response.users).toHaveLength(2);
      expect(response.total).toBe(2);
      expect(response).toHaveProperty('limit');
      expect(response).toHaveProperty('offset');
      expect(response.users[0]).toHaveProperty('id');
      expect(response.users[0]).toHaveProperty('name');
      expect(response.users[0]).toHaveProperty('email');
      expect(response.users[0]).toHaveProperty('role');
    });

    it('exposes the disabled flag for each user', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ disabled: true })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(json.mock.calls[0][0].users[0].disabled).toBe(true);
    });

    it('passes pagination params to findUsers and unfiltered count', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const countUsers = jest.fn().mockResolvedValue(0);
      const deps = createDeps({ findUsers, countUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { limit: '10', offset: '20' } });

      await handlers.listUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith({}, expect.any(String), {
        limit: 10,
        offset: 20,
        sort: { createdAt: -1 },
      });
      expect(countUsers).toHaveBeenCalledWith();
    });

    it('returns empty list when no users', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].users).toEqual([]);
      expect(json.mock.calls[0][0].total).toBe(0);
    });

    it('returns 500 when findUsers throws', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to list users' });
    });

    it('returns 500 when countUsers throws', async () => {
      const deps = createDeps({
        countUsers: jest.fn().mockRejectedValue(new Error('count failed')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to list users' });
    });
  });

  describe('searchUsers', () => {
    it('returns matching users with total and capped flag', async () => {
      const users = [mockUser()];
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue(users) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const response = json.mock.calls[0][0];
      expect(response.users).toHaveLength(1);
      expect(response.total).toBe(1);
      expect(response.capped).toBe(false);
      expect(response.users[0]).toHaveProperty('id');
      expect(response.users[0]).toHaveProperty('name');
      expect(response.users[0]).toHaveProperty('email');
      expect(response.users[0]).toHaveProperty('username');
      expect(response.users[0]).toHaveProperty('role');
      expect(response.users[0]).toHaveProperty('disabled');
    });

    it('projects full list fields (role/disabled) for search', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      const projection = findUsers.mock.calls[0][1];
      expect(projection).toContain('role');
      expect(projection).toContain('disabled');
    });

    it('sets capped to true when results hit the limit', async () => {
      const users = Array.from({ length: 20 }, () => mockUser());
      const deps = createDeps({ findUsers: jest.fn().mockResolvedValue(users) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, json } = createReqRes({ query: { q: 'test', limit: '20' } });

      await handlers.searchUsers(req, res);

      const response = json.mock.calls[0][0];
      expect(response.total).toBe(20);
      expect(response.capped).toBe(true);
    });

    it('searches name, email, and username with anchored prefix regex', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      const filter = findUsers.mock.calls[0][0];
      expect(filter.$or).toHaveLength(3);
      expect(filter.$or[0]).toHaveProperty('name');
      expect(filter.$or[1]).toHaveProperty('email');
      expect(filter.$or[2]).toHaveProperty('username');
      expect(filter.$or[0].name.source).toBe('^test');
    });

    it('projects username in the field selection', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      const projection = findUsers.mock.calls[0][1];
      expect(projection).toContain('username');
    });

    it('escapes regex special characters in query', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'test.user+1' } });

      await handlers.searchUsers(req, res);

      const filter = findUsers.mock.calls[0][0];
      expect(filter.$or[0].name).toBeInstanceOf(RegExp);
      expect(filter.$or[0].name.source).toBe('^test\\.user\\+1');
    });

    it('returns 400 when query is missing', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: {} });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is empty string', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: '' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is whitespace-only', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: '   ' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('returns 400 when query is too short', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'a' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query must be at least 2 characters' });
    });

    it('returns 400 when query exceeds max length', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'a'.repeat(201) } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('200') }),
      );
    });

    it('treats array query param as missing', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: ['foo', 'bar'] } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Query parameter "q" is required' });
    });

    it('passes limit to findUsers', async () => {
      const findUsers = jest.fn().mockResolvedValue([mockUser()]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'User', limit: '3' } });

      await handlers.searchUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        limit: 3,
        sort: { name: 1 },
      });
    });

    it('caps limit at 50', async () => {
      const findUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findUsers });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { q: 'User', limit: '100' } });

      await handlers.searchUsers(req, res);

      expect(findUsers).toHaveBeenCalledWith(expect.any(Object), expect.any(String), {
        limit: 50,
        sort: { name: 1 },
      });
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({ findUsers: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { q: 'test' } });

      await handlers.searchUsers(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to search users' });
    });
  });

  describe('deleteUser', () => {
    it('deletes user and returns 200', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User was deleted successfully.' });
    });

    it('returns fallback message when result.message is empty', async () => {
      const result: UserDeleteResult = { deletedCount: 1, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User deleted successfully' });
    });

    it('returns 403 when deleting own account', async () => {
      const userId = new Types.ObjectId();
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: userId.toString() },
        user: { _id: userId, role: 'admin' },
      });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot delete your own account' });
      expect(deps.deleteUserById).not.toHaveBeenCalled();
    });

    it('returns 400 when deleting the last admin', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot delete the last admin user' });
      expect(deps.deleteUserById).not.toHaveBeenCalled();
      expect(deps.countUsers).toHaveBeenCalledWith({ role: SystemRoles.ADMIN });
    });

    it('allows deleting an admin when other admins exist', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(3),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.deleteUserById).toHaveBeenCalledWith(targetId);
    });

    it('does not check admin count when target is a regular user', async () => {
      const targetId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: 'USER' })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: targetId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.countUsers).not.toHaveBeenCalled();
    });

    it('cascades cleanup of Config and AclEntries', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.deleteConfig).toHaveBeenCalledWith(PrincipalType.USER, validUserId);
      expect(deps.deleteAclEntries).toHaveBeenCalledWith({
        principalType: PrincipalType.USER,
        principalId: expect.any(Types.ObjectId),
      });
    });

    it('returns success even when cascade cleanup partially fails', async () => {
      const result: UserDeleteResult = {
        deletedCount: 1,
        message: 'User was deleted successfully.',
      };
      const deps = createDeps({
        deleteUserById: jest.fn().mockResolvedValue(result),
        deleteConfig: jest.fn().mockRejectedValue(new Error('cleanup failed')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ message: 'User was deleted successfully.' });
    });

    it('does not cascade when user is not found', async () => {
      const result: UserDeleteResult = { deletedCount: 0, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.deleteConfig).not.toHaveBeenCalled();
      expect(deps.deleteAclEntries).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid ObjectId', async () => {
      const deps = createDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: 'not-valid' } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
    });

    it('returns 404 when user not found', async () => {
      const result: UserDeleteResult = { deletedCount: 0, message: '' };
      const deps = createDeps({ deleteUserById: jest.fn().mockResolvedValue(result) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({
        deleteUserById: jest.fn().mockRejectedValue(new Error('db crash')),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to delete user' });
    });
  });

  describe('createUser', () => {
    it('creates a user and returns 201 with mapped fields', async () => {
      const createdId = new Types.ObjectId();
      const createUser = jest.fn().mockResolvedValue({
        _id: createdId,
        name: 'New Hire',
        username: 'new@example.com',
        email: 'new@example.com',
        role: 'USER',
        provider: 'local',
      });
      const hashPassword = jest.fn().mockResolvedValue('hashed');
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(null),
        createUser,
        hashPassword,
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        body: { email: 'New@Example.com', name: 'New Hire', password: 'secret12' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(hashPassword).toHaveBeenCalledWith('secret12');
      const passed = createUser.mock.calls[0][0];
      expect(passed).toMatchObject({
        email: 'new@example.com',
        password: 'hashed',
        provider: 'local',
        role: 'USER',
        emailVerified: true,
      });
      const response = json.mock.calls[0][0];
      expect(response.id).toBe(createdId.toString());
      expect(response.email).toBe('new@example.com');
    });

    it('passes balanceConfig from getBalanceConfig to createUser', async () => {
      const createUser = jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), email: 'a@b.co' });
      const balanceConfig = { enabled: true, startBalance: 1000 };
      const deps = createDeps({
        createUser,
        getBalanceConfig: jest.fn().mockResolvedValue(balanceConfig),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res } = createReqRes({ body: { email: 'a@b.co', password: 'secret12' } });

      await handlers.createUser(req, res);

      expect(createUser.mock.calls[0][1]).toEqual(balanceConfig);
    });

    it('returns 400 for invalid email', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        body: { email: 'nope', password: 'secret12' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Valid email is required' });
    });

    it('returns 400 for a short password', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status } = createReqRes({ body: { email: 'a@b.co', password: 'short' } });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for an invalid role', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        body: { email: 'a@b.co', password: 'secret12', role: 'SUPERUSER' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid role' });
    });

    it('returns 409 when the email already exists', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(mockUser()) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        body: { email: 'a@b.co', password: 'secret12' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(409);
      expect(deps.createUser).not.toHaveBeenCalled();
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({ findUser: jest.fn().mockRejectedValue(new Error('db down')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        body: { email: 'a@b.co', password: 'secret12' },
      });

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to create user' });
    });
  });

  describe('updateUser', () => {
    it('updates name and role and returns 200', async () => {
      const updateUser = jest.fn().mockResolvedValue(mockUser({ name: 'Renamed', role: 'ADMIN' }));
      const deps = createDeps({ updateUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { name: 'Renamed', role: SystemRoles.ADMIN },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(updateUser).toHaveBeenCalledWith(validUserId, {
        name: 'Renamed',
        role: SystemRoles.ADMIN,
      });
    });

    it('hashes and updates the password when provided', async () => {
      const hashPassword = jest.fn().mockResolvedValue('new-hash');
      const updateUser = jest.fn().mockResolvedValue(mockUser());
      const deps = createDeps({ hashPassword, updateUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { password: 'newsecret1' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(hashPassword).toHaveBeenCalledWith('newsecret1');
      expect(updateUser).toHaveBeenCalledWith(validUserId, { password: 'new-hash' });
    });

    it('returns 400 when the new password is too short', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { password: 'short' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid id', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: 'bad' },
        body: { name: 'X' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid user ID format' });
    });

    it('returns 400 for an invalid role', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: 'BOSS' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid role' });
    });

    it('returns 400 when no updatable fields are provided', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({ params: { id: validUserId }, body: {} });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'No updatable fields provided' });
    });

    it('blocks demoting the last admin', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { role: 'USER' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot demote the last admin user' });
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('allows demotion when other admins exist', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(2),
        updateUser: jest.fn().mockResolvedValue(mockUser({ role: 'USER' })),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { role: 'USER' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.updateUser).toHaveBeenCalled();
    });

    it('sets the disabled flag and returns it', async () => {
      const updateUser = jest.fn().mockResolvedValue(mockUser({ disabled: true }));
      const deps = createDeps({ updateUser });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { disabled: true },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(updateUser).toHaveBeenCalledWith(validUserId, { disabled: true });
      expect(json.mock.calls[0][0].disabled).toBe(true);
    });

    it('returns 403 when disabling your own account', async () => {
      const handlers = createAdminUsersHandlers(createDeps());
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { disabled: true },
        user: { _id: new Types.ObjectId(validUserId), role: 'admin' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot disable your own account' });
    });

    it('blocks disabling the last admin', async () => {
      const deps = createDeps({
        findUsers: jest.fn().mockResolvedValue([mockUser({ role: SystemRoles.ADMIN })]),
        countUsers: jest.fn().mockResolvedValue(1),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { disabled: true },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Cannot disable the last admin user' });
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('returns 404 when the user is not found', async () => {
      const deps = createDeps({ updateUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name: 'X' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ error: 'User not found' });
    });

    it('returns 500 on error', async () => {
      const deps = createDeps({ updateUser: jest.fn().mockRejectedValue(new Error('db crash')) });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { name: 'X' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ error: 'Failed to update user' });
    });
  });

  /**
   * The billing operator allowlist lives in env so the client's own admin cannot grant
   * themselves the right to move money. That only holds while they also cannot take the
   * operator's ACCOUNT — they hold MANAGE_USERS, so a password reset would hand it over.
   */
  describe('platform-operator accounts are shielded from client admins', () => {
    const OPERATOR = 'op@1ma.ai';
    const operatorDeps = (overrides: Partial<AdminUsersDeps> = {}) =>
      createDeps({
        protectedEmails: [OPERATOR],
        findUsers: jest.fn().mockResolvedValue([mockUser({ email: OPERATOR })]),
        ...overrides,
      });
    const asClientAdmin = (body: Record<string, unknown>) =>
      createReqRes({
        params: { id: validUserId },
        body,
        user: { _id: new Types.ObjectId(), role: 'ADMIN', email: 'client@corp.by' },
      } as Parameters<typeof createReqRes>[0]);

    it('refuses to reset an operator password from a client admin', async () => {
      const deps = operatorDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = asClientAdmin({ password: 'takeover-123456' });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('refuses to delete an operator account from a client admin', async () => {
      const deps = operatorDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = asClientAdmin({});

      await handlers.deleteUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.deleteUserById).not.toHaveBeenCalled();
    });

    it('refuses to create an account on an operator address from a client admin', async () => {
      const deps = operatorDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        body: { email: OPERATOR, password: 'whatever-123456' },
        user: { _id: new Types.ObjectId(), role: 'ADMIN', email: 'client@corp.by' },
      } as Parameters<typeof createReqRes>[0]);

      await handlers.createUser(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.createUser).not.toHaveBeenCalled();
    });

    it('lets an operator manage an operator account', async () => {
      const deps = operatorDeps();
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { name: 'Оператор' },
        user: { _id: new Types.ObjectId(), role: 'ADMIN', email: OPERATOR },
      } as Parameters<typeof createReqRes>[0]);

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.updateUser).toHaveBeenCalled();
    });

    it('leaves ordinary accounts alone', async () => {
      const deps = createDeps({
        protectedEmails: [OPERATOR],
        findUsers: jest.fn().mockResolvedValue([mockUser({ email: 'staff@corp.by' })]),
      });
      const handlers = createAdminUsersHandlers(deps);
      const { req, res, status } = asClientAdmin({ name: 'Сотрудник' });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.updateUser).toHaveBeenCalled();
    });
  });
});
