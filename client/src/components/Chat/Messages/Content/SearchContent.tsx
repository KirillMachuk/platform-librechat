import { Suspense, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { DelayedRender } from '@librechat/client';
import { ContentTypes } from 'librechat-data-provider';
import type {
  Agents,
  TMessage,
  TAttachment,
  SearchResultData,
  TMessageContentParts,
} from 'librechat-data-provider';
import { TruncatedNote, isTruncatedDrReport } from '~/components/Chat/Messages/DeepResearch';
import { UnfinishedMessage } from './MessageContent';
import { cn, mapAttachments } from '~/utils';
import { SearchContext } from '~/Providers';
import MarkdownLite from './MarkdownLite';
import store from '~/store';
import Part from './Part';

const SearchContent = ({
  message,
  attachments,
  searchResults,
}: {
  message: TMessage;
  attachments?: TAttachment[];
  searchResults?: { [key: string]: SearchResultData };
}) => {
  const enableUserMsgMarkdown = useRecoilValue(store.enableUserMsgMarkdown);
  const { messageId } = message;

  const attachmentMap = useMemo(() => mapAttachments(attachments ?? []), [attachments]);

  if (Array.isArray(message.content) && message.content.length > 0) {
    return (
      <SearchContext.Provider value={{ searchResults }}>
        {message.content
          .filter((part: TMessageContentParts | undefined) => part)
          .map((part: TMessageContentParts | undefined, idx: number) => {
            if (!part) {
              return null;
            }

            const toolCallId =
              (part?.[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined)?.id ?? '';
            const partAttachments = attachmentMap[toolCallId];
            return (
              <Part
                key={`display-${messageId}-${idx}`}
                showCursor={false}
                isSubmitting={false}
                isCreatedByUser={message.isCreatedByUser}
                attachments={partAttachments}
                part={part}
              />
            );
          })}
        {message.unfinished === true &&
          /**
           * A Deep Research report gets the plain note, never the error box.
           *
           * This component only ever renders the SHARE page, and a shared snapshot carries
           * `unfinished` through (see share.ts). So a truncated DR report — a real, usable
           * synthesis — was greeting whoever opened the link with a red role="alert" reading
           * «Не удалось выполнить запрос. Сообщение об ошибке: …». The chat was fixed and this
           * surface was not, which is precisely why the rule is now imported rather than
           * written twice.
           *
           * Everything else keeps the existing indicator: an ordinary answer the reader
           * stopped is genuinely unfinished, and removing that is not this change's business.
           */
          (isTruncatedDrReport(message) ? (
            <TruncatedNote />
          ) : (
            <Suspense>
              <DelayedRender delay={250}>
                <UnfinishedMessage message={message} key={`unfinished-${messageId}`} />
              </DelayedRender>
            </Suspense>
          ))}
      </SearchContext.Provider>
    );
  }

  return (
    <div
      className={cn(
        'markdown prose dark:prose-invert light w-full break-words',
        message.isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
      )}
      dir="auto"
    >
      <MarkdownLite content={message.text || ''} />
    </div>
  );
};

export default SearchContent;
