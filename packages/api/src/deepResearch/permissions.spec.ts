import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { IRole, IUser } from '@librechat/data-schemas';
import type { Request as ServerRequest } from 'express';
import { canUseDeepResearch } from './permissions';

const buildReq = (user?: Partial<IUser>) => ({ user }) as ServerRequest;

const roleWith = (permissions: IRole['permissions']) =>
  jest.fn(async () => ({ name: 'USER', permissions }) as IRole);

describe('canUseDeepResearch', () => {
  const user = { id: 'user-1', role: 'USER' };

  test('allows the run when the role holds DEEP_RESEARCH.USE', async () => {
    const getRoleByName = roleWith({
      [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: true },
    });

    await expect(canUseDeepResearch({ req: buildReq(user), getRoleByName })).resolves.toBe(true);
  });

  test('denies the run when the role lacks DEEP_RESEARCH.USE', async () => {
    const getRoleByName = roleWith({
      [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: false },
    });

    await expect(canUseDeepResearch({ req: buildReq(user), getRoleByName })).resolves.toBe(false);
  });

  /** The two used to share one permission; splitting them is the point of the change. */
  test('does not fall back to WEB_SEARCH when deep research is revoked', async () => {
    const getRoleByName = roleWith({
      [PermissionTypes.WEB_SEARCH]: { [Permissions.USE]: true },
      [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: false },
    });

    await expect(canUseDeepResearch({ req: buildReq(user), getRoleByName })).resolves.toBe(false);
  });

  test('allows deep research for a role that lost plain web search', async () => {
    const getRoleByName = roleWith({
      [PermissionTypes.WEB_SEARCH]: { [Permissions.USE]: false },
      [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: true },
    });

    await expect(canUseDeepResearch({ req: buildReq(user), getRoleByName })).resolves.toBe(true);
  });

  test('fails closed when the role lookup throws', async () => {
    const getRoleByName = jest.fn(async () => {
      throw new Error('mongo is down');
    });

    await expect(canUseDeepResearch({ req: buildReq(user), getRoleByName })).resolves.toBe(false);
  });

  test('denies an unauthenticated request', async () => {
    const getRoleByName = roleWith({
      [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: true },
    });

    await expect(canUseDeepResearch({ req: buildReq(), getRoleByName })).resolves.toBe(false);
  });
});
