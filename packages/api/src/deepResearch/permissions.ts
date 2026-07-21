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
 * Requires BOTH `WEB_SEARCH.USE` and `DEEP_RESEARCH.USE`. Research reaches the open
 * internet, so revoking web search has to stop it too — otherwise an operator who
 * believes they cut a role off from the internet would still have it browsing. The
 * separate `DEEP_RESEARCH` permission then narrows that further: research costs orders of
 * magnitude more than a single search, so a role can keep ordinary search while losing
 * research. The `deep_research` agent capability is not a substitute for either: it is one
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
    for (const permissionType of [PermissionTypes.WEB_SEARCH, PermissionTypes.DEEP_RESEARCH]) {
      const allowed = await checkAccess({
        req,
        user: req.user as IUser,
        permissionType,
        permissions: [Permissions.USE],
        getRoleByName,
      });
      if (!allowed) {
        const user = req.user as IUser | undefined;
        logger.warn(
          `[deepResearch] Denied for user ${user?.id}: role "${user?.role}" lacks ${permissionType}.${Permissions.USE}. Running the turn as an ordinary chat.`,
        );
        return false;
      }
    }
    return true;
  } catch (error) {
    logger.error('[deepResearch] Permission check failed; denying the run', error);
    return false;
  }
}
