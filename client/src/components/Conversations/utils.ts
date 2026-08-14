import type { TConversation } from 'librechat-data-provider';

export type ConversationRenderProps = {
  conversation: TConversation;
  isGenerating?: boolean;
};

export function areConversationIconFieldsEqual(
  prevConversation: TConversation,
  nextConversation: TConversation,
) {
  return (
    prevConversation.endpoint === nextConversation.endpoint &&
    prevConversation.endpointType === nextConversation.endpointType &&
    prevConversation.iconURL === nextConversation.iconURL &&
    prevConversation.model === nextConversation.model &&
    prevConversation.modelLabel === nextConversation.modelLabel &&
    prevConversation.chatGptLabel === nextConversation.chatGptLabel &&
    prevConversation.spec === nextConversation.spec &&
    prevConversation.agent_id === nextConversation.agent_id &&
    prevConversation.assistant_id === nextConversation.assistant_id
  );
}

export function areConversationListItemFieldsEqual(
  prevConversation: TConversation,
  nextConversation: TConversation,
) {
  return (
    areConversationIconFieldsEqual(prevConversation, nextConversation) &&
    prevConversation.conversationId === nextConversation.conversationId &&
    prevConversation.title === nextConversation.title &&
    prevConversation.chatProjectId === nextConversation.chatProjectId &&
    prevConversation.createdAt === nextConversation.createdAt &&
    prevConversation.updatedAt === nextConversation.updatedAt &&
    /* The unread dot derives from this pair; dropping lastReadAt here would
     * freeze a memoized row on its stale dot after the read-stamp lands. */
    prevConversation.lastReadAt === nextConversation.lastReadAt
  );
}

export function areConversationRenderPropsEqual(
  prevProps: ConversationRenderProps,
  nextProps: ConversationRenderProps,
) {
  return (
    areConversationListItemFieldsEqual(prevProps.conversation, nextProps.conversation) &&
    prevProps.isGenerating === nextProps.isGenerating
  );
}
