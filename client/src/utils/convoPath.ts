import { Constants } from 'librechat-data-provider';

type BuildConvoPathArgs = {
  conversationId?: string | null;
  projectId?: string | null;
};

/**
 * Single source of truth for chat URL construction.
 *
 * - `/c/<id>` for chats not bound to a project.
 * - `/projects/<projectId>/c/<id>` when a project context is active.
 * - `<id>` defaults to `Constants.NEW_CONVO` when no conversationId is provided.
 *
 * Both segments are URL-encoded; the `'new'` sentinel is preserved verbatim
 * so React Router matches it against the `conversationId?` param.
 */
export function buildConvoPath({ conversationId, projectId }: BuildConvoPathArgs): string {
  const rawId = conversationId || Constants.NEW_CONVO;
  const idSegment = rawId === Constants.NEW_CONVO ? rawId : encodeURIComponent(rawId);
  if (projectId) {
    return `/projects/${encodeURIComponent(projectId)}/c/${idSegment}`;
  }
  return `/c/${idSegment}`;
}
