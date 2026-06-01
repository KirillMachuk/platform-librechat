import { Types } from 'mongoose';
import { PrincipalType, SystemRoles } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  IConfig,
  BalanceConfig,
  CreateUserRequest,
  AdminUserListItem,
  AdminUserSearchResult,
  UserDeleteResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

const MAX_SEARCH_LENGTH = 200;

const USER_LIST_FIELDS = '_id name username email avatar role provider createdAt updatedAt';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const ASSIGNABLE_ROLES: ReadonlySet<string> = new Set([SystemRoles.USER, SystemRoles.ADMIN]);

export interface AdminUsersDeps {
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
  countUsers: (filter?: FilterQuery<IUser>) => Promise<number>;
  /**
   * Thin data-layer delete — removes the User document only.
   * Full cascade of user-owned resources (conversations, messages, files, tokens, etc.)
   * is handled by `UserController.deleteUserController` in the self-delete flow.
   * This admin endpoint currently cascades Config and AclEntries.
   * A future iteration should consolidate the full cascade into a shared service function.
   */
  deleteUserById: (userId: string) => Promise<UserDeleteResult>;
  deleteConfig: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
  ) => Promise<IConfig | null>;
  deleteAclEntries: (filter: {
    principalType: PrincipalType;
    principalId: string | Types.ObjectId;
  }) => Promise<void>;
  findUser: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser | null>;
  createUser: (
    data: CreateUserRequest,
    balanceConfig?: BalanceConfig,
    disableTTL?: boolean,
    returnUser?: boolean,
  ) => Promise<Types.ObjectId | Partial<IUser>>;
  updateUser: (userId: string, updateData: Partial<IUser>) => Promise<IUser | null>;
  hashPassword: (password: string) => Promise<string>;
  getBalanceConfig?: () => Promise<BalanceConfig | undefined>;
}

export function createAdminUsersHandlers(deps: AdminUsersDeps) {
  const {
    findUsers,
    countUsers,
    findUser,
    createUser,
    updateUser,
    hashPassword,
    getBalanceConfig,
    deleteUserById,
    deleteConfig,
    deleteAclEntries,
  } = deps;

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const [users, total] = await Promise.all([
        findUsers({}, USER_LIST_FIELDS, { limit, offset, sort: { createdAt: -1 } }),
        countUsers(),
      ]);

      const mapped: AdminUserListItem[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        username: u.username ?? '',
        email: u.email ?? '',
        avatar: u.avatar ?? '',
        role: u.role ?? 'USER',
        provider: u.provider ?? 'local',
        createdAt: u.createdAt?.toISOString(),
        updatedAt: u.updatedAt?.toISOString(),
      }));

      return res.status(200).json({ users: mapped, total, limit, offset });
    } catch (error) {
      logger.error('[adminUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function searchUsersHandler(req: ServerRequest, res: Response) {
    try {
      const rawQ = req.query.q;
      const rawLimit = req.query.limit;
      const query = typeof rawQ === 'string' ? rawQ : undefined;
      const limitStr = typeof rawLimit === 'string' ? rawLimit : '20';
      const trimmed = query?.trim() ?? '';

      if (!trimmed) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
      }

      if (trimmed.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
      }

      if (trimmed.length > MAX_SEARCH_LENGTH) {
        return res
          .status(400)
          .json({ error: `Query must not exceed ${MAX_SEARCH_LENGTH} characters` });
      }

      const searchLimit = Math.min(Math.max(1, parseInt(limitStr, 10) || 20), 50);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}`, 'i');

      const users = await findUsers(
        { $or: [{ name: regex }, { email: regex }, { username: regex }] },
        '_id name email username avatar',
        { limit: searchLimit, sort: { name: 1 } },
      );

      const results: AdminUserSearchResult[] = users.map((u) => ({
        id: u._id?.toString() ?? '',
        name: u.name ?? '',
        email: u.email ?? '',
        username: u.username,
        avatarUrl: u.avatar,
      }));

      return res
        .status(200)
        .json({ users: results, total: results.length, capped: results.length >= searchLimit });
    } catch (error) {
      logger.error('[adminUsers] searchUsers error:', error);
      return res.status(500).json({ error: 'Failed to search users' });
    }
  }

  async function deleteUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };

      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const callerId = req.user?._id?.toString() ?? req.user?.id;
      if (callerId === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }

      const [targetUser] = await findUsers({ _id: id }, 'role', { limit: 1 });
      if (targetUser?.role === SystemRoles.ADMIN) {
        const adminCount = await countUsers({ role: SystemRoles.ADMIN });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }
      }

      const result = await deleteUserById(id);

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser?.role === SystemRoles.ADMIN) {
        const remaining = await countUsers({ role: SystemRoles.ADMIN });
        if (remaining === 0) {
          logger.error(
            `[adminUsers] CRITICAL: last admin deleted via race condition, user: ${id}. ` +
              'Manual DB intervention required to restore an ADMIN user.',
          );
        }
      }

      const objectId = new Types.ObjectId(id);
      const cleanupResults = await Promise.allSettled([
        deleteConfig(PrincipalType.USER, id),
        deleteAclEntries({ principalType: PrincipalType.USER, principalId: objectId }),
      ]);
      for (const r of cleanupResults) {
        if (r.status === 'rejected') {
          logger.error('[adminUsers] cascade cleanup failed for user:', id, r.reason);
        }
      }

      return res.status(200).json({ message: result.message || 'User deleted successfully' });
    } catch (error) {
      logger.error('[adminUsers] deleteUser error:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  }

  async function createUserHandler(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as {
        email?: string;
        name?: string;
        username?: string;
        password?: string;
        role?: string;
      };

      const email = body.email?.trim().toLowerCase();
      if (!email || !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Valid email is required' });
      }
      if (!body.password || body.password.length < MIN_PASSWORD_LENGTH) {
        return res
          .status(400)
          .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }
      const role = body.role ?? SystemRoles.USER;
      if (!ASSIGNABLE_ROLES.has(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const existing = await findUser({ email }, '_id');
      if (existing) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const hashedPassword = await hashPassword(body.password);
      const balanceConfig = getBalanceConfig ? await getBalanceConfig() : undefined;
      const created = (await createUser(
        {
          email,
          name: body.name?.trim() || email,
          username: body.username?.trim() || email,
          password: hashedPassword,
          provider: 'local',
          role,
          emailVerified: true,
        },
        balanceConfig,
        true,
        true,
      )) as Partial<IUser>;

      return res.status(201).json({
        id: created._id?.toString() ?? '',
        name: created.name ?? '',
        username: created.username ?? '',
        email: created.email ?? '',
        role: created.role ?? role,
        provider: created.provider ?? 'local',
        createdAt: created.createdAt?.toISOString(),
      });
    } catch (error) {
      logger.error('[adminUsers] createUser error:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  async function updateUserHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const body = (req.body ?? {}) as {
        name?: string;
        username?: string;
        role?: string;
        password?: string;
      };
      const update: Partial<IUser> = {};
      if (typeof body.name === 'string') {
        update.name = body.name.trim();
      }
      if (typeof body.username === 'string') {
        update.username = body.username.trim();
      }
      if (typeof body.role === 'string') {
        if (!ASSIGNABLE_ROLES.has(body.role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }
        update.role = body.role;
      }
      if (typeof body.password === 'string') {
        if (body.password.length < MIN_PASSWORD_LENGTH) {
          return res
            .status(400)
            .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        update.password = await hashPassword(body.password);
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }

      if (update.role && update.role !== SystemRoles.ADMIN) {
        const [target] = await findUsers({ _id: id }, 'role', { limit: 1 });
        if (target?.role === SystemRoles.ADMIN) {
          const adminCount = await countUsers({ role: SystemRoles.ADMIN });
          if (adminCount <= 1) {
            return res.status(400).json({ error: 'Cannot demote the last admin user' });
          }
        }
      }

      const updated = await updateUser(id, update);
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({
        id: updated._id?.toString() ?? id,
        name: updated.name ?? '',
        username: updated.username ?? '',
        email: updated.email ?? '',
        role: updated.role ?? 'USER',
        provider: updated.provider ?? 'local',
      });
    } catch (error) {
      logger.error('[adminUsers] updateUser error:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }

  return {
    listUsers: listUsersHandler,
    searchUsers: searchUsersHandler,
    createUser: createUserHandler,
    updateUser: updateUserHandler,
    deleteUser: deleteUserHandler,
  };
}
