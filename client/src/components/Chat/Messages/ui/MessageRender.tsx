import React, { useCallback, useMemo, memo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import type { TMessageProps, TMessageChatContext } from '~/common';
import { cn, chatColumnClass, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import useAskUserChip from '~/components/Chat/Messages/DeepResearch/useAskUserChip';
import useDrCommand from '~/components/Chat/Messages/DeepResearch/useDrCommand';
import MessageContent from '~/components/Chat/Messages/Content/MessageContent';
import { useLocalize, useMessageActions, useContentMetadata } from '~/hooks';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import { USER_BUBBLE_CLASS } from '~/components/Chat/Messages/ui/turn';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import SubRow from '~/components/Chat/Messages/SubRow';
import { MessageContext } from '~/Providers';
import store from '~/store';

type MessageRenderProps = {
  message?: TMessage;
  /**
   * Effective isSubmitting: false for non-latest messages, real value for latest.
   * Computed by the wrapper (Message.tsx) so this memo'd component only re-renders
   * when the value actually matters.
   */
  isSubmitting?: boolean;
  /** Stable context object from wrapper — avoids ChatContext subscription inside memo */
  chatContext: TMessageChatContext;
} & Pick<
  TMessageProps,
  'currentEditId' | 'setCurrentEditId' | 'siblingIdx' | 'setSiblingIdx' | 'siblingCount'
>;

/**
 * Custom comparator for React.memo: compares `message` by key fields instead of reference
 * because `buildTree` creates new message objects on every streaming update for ALL messages,
 * even when only the latest message's text changed.
 */
function areMessageRenderPropsEqual(prev: MessageRenderProps, next: MessageRenderProps): boolean {
  if (prev.isSubmitting !== next.isSubmitting) {
    return false;
  }
  if (prev.chatContext !== next.chatContext) {
    return false;
  }
  if (prev.siblingIdx !== next.siblingIdx) {
    return false;
  }
  if (prev.siblingCount !== next.siblingCount) {
    return false;
  }
  if (prev.currentEditId !== next.currentEditId) {
    return false;
  }
  if (prev.setSiblingIdx !== next.setSiblingIdx) {
    return false;
  }
  if (prev.setCurrentEditId !== next.setCurrentEditId) {
    return false;
  }

  const prevMsg = prev.message;
  const nextMsg = next.message;
  if (prevMsg === nextMsg) {
    return true;
  }
  if (!prevMsg || !nextMsg) {
    return prevMsg === nextMsg;
  }

  return (
    prevMsg.messageId === nextMsg.messageId &&
    /* Both chip rules resolve their parent by this id; a late id swap during the
     * SSE lifecycle must therefore reach the render. */
    prevMsg.parentMessageId === nextMsg.parentMessageId &&
    prevMsg.text === nextMsg.text &&
    prevMsg.error === nextMsg.error &&
    prevMsg.unfinished === nextMsg.unfinished &&
    prevMsg.createdAt === nextMsg.createdAt &&
    prevMsg.depth === nextMsg.depth &&
    /* The DR action chip reads it, so a `drKind` that lands late (the server save
     * arriving over the optimistic command message) has to reach the render — the
     * same field ContentRender's comparator already carries. */
    prevMsg.drKind === nextMsg.drKind &&
    prevMsg.isCreatedByUser === nextMsg.isCreatedByUser &&
    (prevMsg.children?.length ?? 0) === (nextMsg.children?.length ?? 0) &&
    prevMsg.content === nextMsg.content &&
    prevMsg.model === nextMsg.model &&
    prevMsg.endpoint === nextMsg.endpoint &&
    prevMsg.iconURL === nextMsg.iconURL &&
    prevMsg.feedback?.rating === nextMsg.feedback?.rating &&
    (prevMsg.files?.length ?? 0) === (nextMsg.files?.length ?? 0)
  );
}

const MessageRender = memo(function MessageRender({
  message: msg,
  siblingIdx,
  siblingCount,
  setSiblingIdx,
  currentEditId,
  setCurrentEditId,
  isSubmitting = false,
  chatContext,
}: MessageRenderProps) {
  const localize = useLocalize();
  /* Shared with ContentRender — a chip must behave identically on both
   * user-message render paths (review К3). This is the path the DR command
   * messages actually take: nothing gives a user message `content`, so
   * mounting the action chip on ContentRender alone left it dead. */
  const askChip = useAskUserChip(msg);
  const drCommand = useDrCommand(msg);
  const {
    ask,
    edit,
    index,
    enterEdit,
    conversation,
    handleFeedback,
    handleContinue,
    latestMessageId,
    copyToClipboard,
    regenerateMessage,
    latestMessageDepth,
  } = useMessageActions({
    message: msg,
    currentEditId,
    setCurrentEditId,
    chatContext,
  });
  /**
   * A chip replaces the whole message body, and `MessageContent` is what hosts the
   * edit textarea — so a chip that ignores `edit` turns the message's own Edit button
   * into a no-op: the bubble class drops, the chip slides to the left, and nothing
   * else happens. Editing worked on this path before any chip existed and must
   * survive it, so the editor wins while it is open.
   */
  const chip = edit ? null : askChip;
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
  const hasNoChildren = !(msg?.children?.length ?? 0);
  const isLast = useMemo(
    () => hasNoChildren && (msg?.depth === latestMessageDepth || msg?.depth === -1),
    [hasNoChildren, msg?.depth, latestMessageDepth],
  );
  const isLatestMessage = msg?.messageId === latestMessageId;

  const { hasParallelContent } = useContentMetadata(msg);
  const messageId = msg?.messageId ?? '';
  const messageContextValue = useMemo(
    () => ({
      messageId,
      isLatestMessage,
      isExpanded: false as const,
      isSubmitting,
      conversationId: conversation?.conversationId,
    }),
    [messageId, conversation?.conversationId, isSubmitting, isLatestMessage],
  );

  if (!msg) {
    return null;
  }

  /* r25 (owner): DR command rows are hidden — the progress/report card says
   * «запущено», the plan card's badge says «отменено». See useDrCommand. */
  if (drCommand != null && !edit) {
    return null;
  }

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu ',
    chat: chatColumnClass(maximizeChatSpace, hasParallelContent),
  };

  const conditionalClasses = {
    focus: 'focus-visible:outline-none',
  };

  const isUserTurn = msg.isCreatedByUser === true;
  const showUserBubble = isUserTurn && !edit;

  return (
    <div
      id={msg.messageId}
      aria-label={getMessageAriaLabel(msg, localize)}
      className={cn(
        baseClasses.common,
        baseClasses.chat,
        conditionalClasses.focus,
        'message-render',
      )}
    >
      <div className={cn('relative flex w-full flex-col', isUserTurn ? 'user-turn' : 'agent-turn')}>
        <h2 className="sr-only">{getHeaderPrefixForScreenReader(msg, localize)}</h2>

        <div className="flex flex-col gap-1">
          <div
            className={cn(
              'flex min-h-[20px] max-w-full flex-grow flex-col gap-0',
              showUserBubble && 'items-end',
            )}
          >
            <div className={cn(showUserBubble && chip == null && USER_BUBBLE_CLASS)}>
              {chip ?? (
                <MessageContext.Provider value={messageContextValue}>
                  <MessageContent
                    ask={ask}
                    edit={edit}
                    isLast={isLast}
                    text={msg.text || ''}
                    message={msg}
                    enterEdit={enterEdit}
                    error={!!(msg.error ?? false)}
                    isSubmitting={isSubmitting}
                    unfinished={msg.unfinished ?? false}
                    isCreatedByUser={msg.isCreatedByUser ?? true}
                    siblingIdx={siblingIdx ?? 0}
                    setSiblingIdx={setSiblingIdx ?? (() => ({}))}
                  />
                </MessageContext.Provider>
              )}
            </div>
          </div>
          {hasNoChildren && isSubmitting ? (
            <PlaceholderRow />
          ) : (
            <SubRow classes={cn('text-xs', isUserTurn && 'justify-end')}>
              <SiblingSwitch
                siblingIdx={siblingIdx}
                siblingCount={siblingCount}
                setSiblingIdx={setSiblingIdx}
              />
              <HoverButtons
                index={index}
                isEditing={edit}
                message={msg}
                enterEdit={enterEdit}
                isSubmitting={chatContext.isSubmitting}
                conversation={conversation ?? null}
                regenerate={handleRegenerateMessage}
                copyToClipboard={copyToClipboard}
                handleContinue={handleContinue}
                latestMessageId={latestMessageId}
                handleFeedback={handleFeedback}
                isLast={isLast}
              />
            </SubRow>
          )}
        </div>
      </div>
    </div>
  );
}, areMessageRenderPropsEqual);
MessageRender.displayName = 'MessageRender';

export default MessageRender;
