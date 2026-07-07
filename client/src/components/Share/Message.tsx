import type { TMessageProps } from '~/common';
import MinimalHoverButtons from '~/components/Chat/Messages/MinimalHoverButtons';
import MessageContent from '~/components/Chat/Messages/Content/MessageContent';
import SearchContent from '~/components/Chat/Messages/Content/SearchContent';
import { USER_BUBBLE_CLASS } from '~/components/Chat/Messages/ui/turn';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import { cn, getHeaderPrefixForScreenReader } from '~/utils';
import SubRow from '~/components/Chat/Messages/SubRow';
import { useAttachments, useLocalize } from '~/hooks';
import { MessageContext } from '~/Providers';
import MultiMessage from './MultiMessage';

export default function Message(props: TMessageProps) {
  const localize = useLocalize();
  const {
    message,
    siblingIdx,
    siblingCount,
    conversation,
    setSiblingIdx,
    currentEditId,
    setCurrentEditId,
  } = props;

  const { attachments, searchResults } = useAttachments({
    messageId: message?.messageId,
    attachments: message?.attachments,
  });

  if (!message) {
    return null;
  }

  const {
    text = '',
    children,
    error = false,
    messageId = '',
    unfinished = false,
    isCreatedByUser = true,
  } = message;

  const isUserTurn = isCreatedByUser === true;

  return (
    <>
      <div className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent">
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div className="final-completion group mx-auto flex flex-1 gap-3 md:max-w-[47rem] md:px-5 lg:px-1 xl:max-w-[55rem] xl:px-5">
            <div
              className={cn(
                'relative flex w-full flex-col',
                isUserTurn ? 'user-turn' : 'agent-turn',
              )}
            >
              <h2 className="sr-only">{getHeaderPrefixForScreenReader(message, localize)}</h2>
              <div className="flex flex-col gap-1 md:gap-3">
                <div
                  className={cn(
                    'flex min-h-[20px] max-w-full flex-grow flex-col gap-0',
                    isUserTurn && 'items-end',
                  )}
                >
                  <div className={cn(isUserTurn && USER_BUBBLE_CLASS)}>
                    <MessageContext.Provider
                      value={{
                        messageId,
                        isExpanded: false,
                        conversationId: conversation?.conversationId,
                        isSubmitting: false, // Share view is always read-only
                        isLatestMessage: false, // No concept of latest message in share view
                      }}
                    >
                      {message.content ? (
                        <SearchContent
                          message={message}
                          attachments={attachments}
                          searchResults={searchResults}
                        />
                      ) : (
                        <MessageContent
                          edit={false}
                          error={error}
                          isLast={false}
                          ask={() => {}}
                          text={text || ''}
                          message={message}
                          isSubmitting={false}
                          enterEdit={() => ({})}
                          unfinished={unfinished}
                          siblingIdx={siblingIdx ?? 0}
                          isCreatedByUser={isCreatedByUser}
                          setSiblingIdx={setSiblingIdx ?? (() => ({}))}
                        />
                      )}
                    </MessageContext.Provider>
                  </div>
                </div>
              </div>
              <SubRow classes={cn('text-xs', isUserTurn && 'justify-end')}>
                <SiblingSwitch
                  siblingIdx={siblingIdx}
                  siblingCount={siblingCount}
                  setSiblingIdx={setSiblingIdx}
                />
                <MinimalHoverButtons message={message} searchResults={searchResults} />
              </SubRow>
            </div>
          </div>
        </div>
      </div>
      <MultiMessage
        key={messageId}
        messageId={messageId}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}
