import React from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TMessageProps } from '~/common';
import { useMessageHelpers, useLocalize, useAttachments, useContentMetadata } from '~/hooks';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import ContentParts from './Content/ContentParts';
import SiblingSwitch from './SiblingSwitch';
import MultiMessage from './MultiMessage';
import HoverButtons from './HoverButtons';
import Files from './Content/Files';
import SubRow from './SubRow';
import store from '~/store';

export default function Message(props: TMessageProps) {
  const localize = useLocalize();
  const { message, siblingIdx, siblingCount, setSiblingIdx, currentEditId, setCurrentEditId } =
    props;
  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });
  const {
    edit,
    index,
    isLast,
    enterEdit,
    handleScroll,
    conversation,
    isSubmitting,
    latestMessageId,
    handleContinue,
    copyToClipboard,
    regenerateMessage,
  } = useMessageHelpers(props);

  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const { children, messageId = null, isCreatedByUser } = message ?? {};

  const { hasParallelContent } = useContentMetadata(message);

  if (!message) {
    return null;
  }

  const getChatWidthClass = () => {
    if (maximizeChatSpace) {
      return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
    }
    if (hasParallelContent) {
      return 'md:max-w-[58rem] xl:max-w-[70rem]';
    }
    return 'md:max-w-[47rem] xl:max-w-[55rem]';
  };

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu',
    chat: getChatWidthClass(),
  };

  return (
    <>
      <div
        className="w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div
            id={messageId ?? ''}
            aria-label={getMessageAriaLabel(message, localize)}
            className={cn(
              baseClasses.common,
              baseClasses.chat,
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
              'message-render',
            )}
          >
            <div
              className={cn(
                'relative flex w-full flex-col',
                isCreatedByUser ? 'user-turn' : 'agent-turn',
              )}
            >
              <h2 className="sr-only">{getHeaderPrefixForScreenReader(message, localize)}</h2>
              <div className="flex flex-col gap-1">
                <div
                  className={cn(
                    'flex min-h-[20px] max-w-full flex-grow flex-col gap-0',
                    isCreatedByUser === true && !edit && 'items-end',
                  )}
                >
                  <div
                    className={cn(
                      isCreatedByUser === true &&
                        !edit &&
                        'max-w-[70%] rounded-3xl bg-[#F3F3F3] px-4 py-2 dark:bg-surface-tertiary',
                    )}
                  >
                    <ContentParts
                      edit={edit}
                      isLast={isLast}
                      enterEdit={enterEdit}
                      siblingIdx={siblingIdx}
                      attachments={attachments}
                      isSubmitting={isSubmitting}
                      searchResults={searchResults}
                      manualSkills={message.manualSkills}
                      messageId={message.messageId}
                      setSiblingIdx={setSiblingIdx}
                      isCreatedByUser={message.isCreatedByUser}
                      conversationId={conversation?.conversationId}
                      isLatestMessage={messageId === latestMessageId}
                      content={message.content as Array<TMessageContentParts | undefined>}
                    />
                  </div>
                  {/* Assistant-side file artifacts (e.g. the Deep Research report PDF):
                      Container renders message.files for USER messages only, so without
                      this the assistant's attached files never appear. Images excluded —
                      generated images render through content parts/attachments. */}
                  {isCreatedByUser !== true && <Files message={message} nonImageOnly />}
                </div>
                {isLast && isSubmitting ? (
                  <div className="mt-1 h-[31px] bg-transparent" />
                ) : (
                  <SubRow classes={cn('text-xs', isCreatedByUser === true && 'justify-end')}>
                    <SiblingSwitch
                      siblingIdx={siblingIdx}
                      siblingCount={siblingCount}
                      setSiblingIdx={setSiblingIdx}
                    />
                    <HoverButtons
                      index={index}
                      isEditing={edit}
                      message={message}
                      enterEdit={enterEdit}
                      isSubmitting={isSubmitting}
                      conversation={conversation ?? null}
                      regenerate={() => regenerateMessage()}
                      copyToClipboard={copyToClipboard}
                      handleContinue={handleContinue}
                      latestMessageId={latestMessageId}
                      isLast={isLast}
                    />
                  </SubRow>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MultiMessage
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
