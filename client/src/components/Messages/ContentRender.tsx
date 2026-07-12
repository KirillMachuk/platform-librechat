import { useCallback, useMemo, memo } from 'react';
import { useRecoilValue } from 'recoil';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, isDrStartCommand, isDrCancelCommand } from 'librechat-data-provider';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TMessageProps, TMessageChatContext } from '~/common';
import {
  PlanCard,
  ReportCard,
  ActionChip,
  RunningSlot,
  resolveDrReport,
} from '~/components/Chat/Messages/DeepResearch';
import { useAttachments, useLocalize, useMessageActions, useContentMetadata } from '~/hooks';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import ContentParts from '~/components/Chat/Messages/Content/ContentParts';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import { USER_BUBBLE_CLASS } from '~/components/Chat/Messages/ui/turn';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import Files from '~/components/Chat/Messages/Content/Files';
import SubRow from '~/components/Chat/Messages/SubRow';
import store from '~/store';

type ContentRenderProps = {
  message?: TMessage;
  /**
   * Effective isSubmitting: false for non-latest messages, real value for latest.
   * Computed by the wrapper (MessageContent.tsx) so this memo'd component only re-renders
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
 * because `buildTree` creates new message objects on every streaming update for ALL messages.
 */
function areContentRenderPropsEqual(prev: ContentRenderProps, next: ContentRenderProps): boolean {
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
    prevMsg.text === nextMsg.text &&
    prevMsg.error === nextMsg.error &&
    prevMsg.unfinished === nextMsg.unfinished &&
    prevMsg.createdAt === nextMsg.createdAt &&
    prevMsg.depth === nextMsg.depth &&
    prevMsg.drKind === nextMsg.drKind &&
    prevMsg.isCreatedByUser === nextMsg.isCreatedByUser &&
    (prevMsg.children?.length ?? 0) === (nextMsg.children?.length ?? 0) &&
    prevMsg.content === nextMsg.content &&
    prevMsg.model === nextMsg.model &&
    prevMsg.endpoint === nextMsg.endpoint &&
    prevMsg.iconURL === nextMsg.iconURL &&
    prevMsg.feedback?.rating === nextMsg.feedback?.rating &&
    (prevMsg.files?.length ?? 0) === (nextMsg.files?.length ?? 0) &&
    (prevMsg.attachments?.length ?? 0) === (nextMsg.attachments?.length ?? 0) &&
    (prevMsg.manualSkills?.length ?? 0) === (nextMsg.manualSkills?.length ?? 0) &&
    (prevMsg.alwaysAppliedSkills?.length ?? 0) === (nextMsg.alwaysAppliedSkills?.length ?? 0)
  );
}

const ContentRender = memo(function ContentRender({
  message: msg,
  siblingIdx,
  siblingCount,
  setSiblingIdx,
  currentEditId,
  setCurrentEditId,
  isSubmitting = false,
  chatContext,
}: ContentRenderProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { attachments, searchResults } = useAttachments({
    messageId: msg?.messageId,
    attachments: msg?.attachments,
  });
  const {
    edit,
    index,
    enterEdit,
    conversation,
    handleContinue,
    handleFeedback,
    latestMessageId,
    copyToClipboard,
    regenerateMessage,
    latestMessageDepth,
  } = useMessageActions({
    message: msg,
    searchResults,
    currentEditId,
    setCurrentEditId,
    chatContext,
  });
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
  const isLast = useMemo(
    () => !(msg?.children?.length ?? 0) && (msg?.depth === latestMessageDepth || msg?.depth === -1),
    [msg?.children, msg?.depth, latestMessageDepth],
  );
  const hasNoChildren = !(msg?.children?.length ?? 0);
  const isLatestMessage = msg?.messageId === latestMessageId;

  const { hasParallelContent } = useContentMetadata(msg);

  // Task #21 phase 3: a FINISHED Deep Research report → collapsible ReportCard + reader.
  // Review r2: keyed on the persisted `drKind` provenance (no text sniffing, no ancestor
  // walk) — prose that merely looks like a report stays plain markdown, and PROCEED-direct
  // reports get the card too. Gated on !isSubmitting so it never runs mid-stream (the
  // running slot owns that window). Legacy pre-drKind reports render plain.
  const drReport = useMemo(() => {
    if (!msg || isSubmitting || msg.isCreatedByUser === true) {
      return null;
    }
    return resolveDrReport(msg);
  }, [msg, isSubmitting]);

  if (!msg) {
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
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu ',
    chat: getChatWidthClass(),
  };

  const conditionalClasses = {
    focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
  };

  const isUserTurn = msg.isCreatedByUser === true;
  const showUserBubble = isUserTurn && !edit;

  // Task #21 Deep Research card states. Review r2: every card mounts on the PERSISTED
  // `drKind` provenance the runner stamps at message creation — never on display text, so
  // a normal-chat answer that merely starts with the plan-marker prose can never grow live
  // buttons or an autostart fuse. The one text-assisted case is the OPTIMISTIC command
  // message (no drKind until the server save lands): the command text counts only under a
  // drKind-verified plan/clarify parent from the cache. The running slot alone subscribes
  // to dr_progress and renders only during a run (isSubmitting gates it off terminally).
  const msgText = msg.text ?? '';
  const isDrCommandKind = msg.drKind === 'start' || msg.drKind === 'cancel';
  const isDrCommandText = isDrStartCommand(msgText) || isDrCancelCommand(msgText);
  let isDrActionChip = isUserTurn && isDrCommandKind;
  if (!isDrActionChip && isUserTurn && isDrCommandText) {
    const cached = queryClient.getQueryData<TMessage[]>([
      QueryKeys.messages,
      conversation?.conversationId,
    ]);
    const parent = cached?.find((m) => m.messageId === msg.parentMessageId);
    isDrActionChip = parent?.drKind === 'plan' || parent?.drKind === 'clarify';
  }
  const isDrPlanCard = !isUserTurn && msg.drKind === 'plan';
  const mountDrRunningSlot = !isUserTurn && !isDrPlanCard && isLatestMessage && isSubmitting;

  let drCard: ReactNode = null;
  if (isDrActionChip) {
    drCard = <ActionChip text={msgText} />;
  } else if (isDrPlanCard) {
    // awaitingAction = the unanswered tip of the DISPLAYED branch. `isLast` (depth-based)
    // keeps a plan variant re-shown via the sibling switcher live (review r2). But `isLast`
    // compares msg.depth (from buildTree) to latestMessageDepth (from the latestMessage
    // atom), and on a FOLLOW-UP turn's freshly-finalized card those two briefly disagree —
    // the just-arrived re-plan/clarify→plan card gets no depth match, so it rendered with NO
    // buttons/timer until a reload (task #21 live bug). `isLatestMessage` (stable id match)
    // covers that case; ORing keeps the sibling-switcher case working. hasNoChildren still
    // gates: once Начать/an edit is sent the card has a child and goes inert.
    drCard = (
      <PlanCard message={msg} awaitingAction={hasNoChildren && (isLast || isLatestMessage)} />
    );
  }

  const contentPartsEl = (
    <ContentParts
      edit={edit}
      isLast={isLast}
      enterEdit={enterEdit}
      siblingIdx={siblingIdx}
      messageId={msg.messageId}
      attachments={attachments}
      searchResults={searchResults}
      manualSkills={msg.manualSkills}
      setSiblingIdx={setSiblingIdx}
      isLatestMessage={isLatestMessage}
      isSubmitting={isSubmitting}
      isCreatedByUser={msg.isCreatedByUser}
      createdAt={msg.createdAt ?? msg.clientTimestamp}
      conversationId={conversation?.conversationId}
      content={msg.content as Array<TMessageContentParts | undefined>}
    />
  );

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
            <div className={cn(showUserBubble && !isDrActionChip && USER_BUBBLE_CLASS)}>
              {drCard ??
                (drReport ? (
                  <ReportCard title={drReport.title} text={msgText}>
                    {contentPartsEl}
                  </ReportCard>
                ) : (
                  <>
                    {mountDrRunningSlot && (
                      <RunningSlot conversationId={conversation?.conversationId} />
                    )}
                    {contentPartsEl}
                  </>
                ))}
            </div>
            {/* Assistant-side file artifacts (e.g. the Deep Research report PDF):
                Container renders message.files for USER messages only, so without this
                the assistant's attached files never appear. Images excluded — generated
                images render through content parts/attachments. */}
            {msg.isCreatedByUser !== true && <Files message={msg} nonImageOnly />}
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
                message={msg}
                isEditing={edit}
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
}, areContentRenderPropsEqual);
ContentRender.displayName = 'ContentRender';

export default ContentRender;
