import { logger } from '@librechat/data-schemas';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { IRole, IUser } from '@librechat/data-schemas';
import type { Request as ServerRequest } from 'express';
import { checkAccess } from '../middleware/access';

export interface CanUseDeepResearchParams {
  req: ServerRequest;
  getRoleByName: (roleName: string, fieldsToSelect?: string | string[]) => Promise<IRole | null>;
}

/**
 * Whether this request's user may run Deep Research.
 *
 * Deep Research has its own permission, seeded from `interface.deepResearch`, so a role
 * can lose research without losing ordinary web search — the two differ by orders of
 * magnitude in cost. The `deep_research` agent capability is not a substitute: it is one
 * switch for the whole tenant and cannot express "this role may not research", so on its
 * own it let any request carrying `ephemeralAgent.deep_research` run a full research
 * graph regardless of role.
 *
 * Call this at admission — where a turn is *routed* into Deep Research — never on the
 * run path. A run that has been admitted must reach its end; this must not be able to
 * cut one short.
 *
 * Fails closed: a role lookup that throws denies the run rather than granting the
 * expensive path (mirrors the FILE_CITATIONS gate in handleTools.js). The cost is that
 * a transient lookup failure answers the turn as an ordinary chat; that is recoverable
 * by retrying, whereas failing open hands Deep Research to every revoked role for the
 * duration of the outage.
 */
export async function canUseDeepResearch({
  req,
  getRoleByName,
}: CanUseDeepResearchParams): Promise<boolean> {
  try {
    const allowed = await checkAccess({
      req,
      user: req.user as IUser,
      permissionType: PermissionTypes.DEEP_RESEARCH,
      permissions: [Permissions.USE],
      getRoleByName,
    });
    if (!allowed) {
      const user = req.user as IUser | undefined;
      logger.warn(
        `[deepResearch] Denied for user ${user?.id}: role "${user?.role}" lacks ${PermissionTypes.DEEP_RESEARCH}.${Permissions.USE}. Running the turn as an ordinary chat.`,
      );
    }
    return allowed;
  } catch (error) {
    logger.error('[deepResearch] Permission check failed; denying the run', error);
    return false;
  }
}
