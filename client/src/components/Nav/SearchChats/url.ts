import { buildConvoPath } from '~/utils';

type SearchResultTarget = {
  conversationId: string;
  /** Chats inside a project live at a different URL; without this the link loses the project. */
  projectId?: string;
  /** Present when the hit was found in a message body rather than the title. */
  messageId?: string;
};

/**
 * One builder for both ways of opening a result — clicking a row and pressing
 * Enter — which previously carried separate copies of the same hardcoded path.
 */
export function buildSearchResultUrl({
  conversationId,
  projectId,
  messageId,
}: SearchResultTarget): string {
  const path = buildConvoPath({ conversationId, projectId });
  return messageId ? `${path}#msg=${messageId}` : path;
}
