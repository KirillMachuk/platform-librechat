import React, { useState, useMemo, memo } from 'react';
import { useRecoilState } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
/* Owner's 11.08-4 picks: pencil / copy / check / repeat, drawn by the Tabler
   shims — the upstream hand-drawn svgs these replace predated the migration. */
import { Check, Copy, Pencil, PlayerTrackNext, Repeat } from '~/components/icons';
import type { TConversation, TMessage, TFeedback } from 'librechat-data-provider';
import { useGenerationsByLatest, useLocalize } from '~/hooks';
import { Fork } from '~/components/Conversations';
import MessageAudio from './MessageAudio';
import Feedback from './Feedback';
import { cn } from '~/utils';
import store from '~/store';

type THoverButtons = {
  isEditing: boolean;
  enterEdit: (cancel?: boolean) => void;
  copyToClipboard: (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => void;
  conversation: TConversation | null;
  isSubmitting: boolean;
  message: TMessage;
  regenerate: () => void;
  handleContinue: (e: React.MouseEvent<HTMLButtonElement>) => void;
  latestMessageId?: string;
  isLast: boolean;
  index: number;
  handleFeedback?: ({ feedback }: { feedback: TFeedback | undefined }) => void;
};

type HoverButtonProps = {
  id?: string;
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  icon: React.ReactNode;
  isActive?: boolean;
  isVisible?: boolean;
  isDisabled?: boolean;
  isLast?: boolean;
  className?: string;
  buttonStyle?: string;
};

const extractMessageContent = (message: TMessage): string => {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part == null) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part) {
          return part.text || '';
        }
        if ('think' in part) {
          const think = part.think;
          if (typeof think === 'string') {
            return think;
          }
          return think && 'text' in think ? think.text || '' : '';
        }
        return '';
      })
      .join('');
  }

  return message.text || '';
};

const HoverButton = memo(
  ({
    id,
    onClick,
    title,
    icon,
    isActive = false,
    isVisible = true,
    isDisabled = false,
    className = '',
  }: HoverButtonProps) => {
    const buttonStyle = cn(
      'hover-button tap-target flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary-alt [&_svg]:h-4 [&_svg]:w-4',
      'hover:text-text-primary hover:bg-surface-hover',
      /* Канон §6.2, решение владельца: кнопки под сообщением видны ВСЕГДА.
         `isVisible` остаётся только для СТРУКТУРНЫХ случаев (это сообщение в
         этом чате нередактируемо в принципе); временная невозможность — это
         disabled с канонным затемнением 45, а не исчезновение. Ветки взаимо-
         исключающие, иначе twMerge оставил бы обе opacity и позднее правило
         в каскаде тихо победило бы. */
      'group-hover:visible group-focus-within:visible group-[.final-completion]:visible',
      isVisible
        ? 'disabled:cursor-not-allowed disabled:opacity-45'
        : 'pointer-events-none opacity-0',
      'focus-visible:outline-none',
      isActive && isVisible && 'text-text-primary bg-surface-hover',
      className,
    );

    return (
      /* The canon §6.6 plate instead of the native title balloon, and an
         aria-label so the row reads to a screen reader (review 11.08). */
      <TooltipAnchor
        description={title}
        render={
          <button
            id={id}
            className={buttonStyle}
            onClick={onClick}
            type="button"
            aria-label={title}
            disabled={isDisabled}
          >
            {icon}
          </button>
        }
      />
    );
  },
);

HoverButton.displayName = 'HoverButton';

const HoverButtons = ({
  index,
  isEditing,
  enterEdit,
  copyToClipboard,
  conversation,
  isSubmitting,
  message,
  regenerate,
  handleContinue,
  latestMessageId,
  isLast,
  handleFeedback,
}: THoverButtons) => {
  const localize = useLocalize();
  const [isCopied, setIsCopied] = useState(false);
  const [TextToSpeech] = useRecoilState<boolean>(store.textToSpeech);

  /**
   * When the turn holds two answers side by side, this row cannot speak for
   * either of them: Copy would not say which answer it took, and a thumb would
   * not say which answer it judged. Those two move into each column's own
   * header; what stays here is what genuinely belongs to the turn — edit the
   * question, fork it, run it again.
   */
  const isComparison = useMemo(
    () => (message.content ?? []).some((part) => part?.groupId != null),
    [message.content],
  );

  const endpoint = useMemo(() => {
    if (!conversation) {
      return '';
    }
    return conversation.endpointType ?? conversation.endpoint;
  }, [conversation]);

  const generationCapabilities = useGenerationsByLatest({
    isEditing,
    isSubmitting,
    error: message.error,
    endpoint: endpoint ?? '',
    messageId: message.messageId,
    searchResult: message.searchResult,
    finish_reason: message.finish_reason,
    isCreatedByUser: message.isCreatedByUser,
    latestMessageId: latestMessageId,
  });

  const {
    editUnavailable,
    regenerateEnabled,
    continueSupported,
    forkingSupported,
    isEditableEndpoint,
  } = generationCapabilities;

  if (!conversation) {
    return null;
  }

  const { isCreatedByUser, error } = message;

  if (error === true) {
    return (
      <div className="visible flex justify-center self-end lg:justify-start">
        {regenerateEnabled && (
          <HoverButton
            onClick={regenerate}
            title={localize('com_ui_regenerate')}
            icon={<Repeat size="19" />}
            isLast={isLast}
          />
        )}
      </div>
    );
  }

  const onEdit = () => {
    if (isEditing) {
      return enterEdit(true);
    }
    enterEdit();
  };

  const handleCopy = () => copyToClipboard(setIsCopied);

  return (
    <div className="group visible flex justify-center gap-2.5 self-end focus-within:outline-none lg:justify-start">
      {/* Text to Speech */}
      {TextToSpeech && (
        <MessageAudio
          index={index}
          isLast={isLast}
          messageId={message.messageId}
          content={extractMessageContent(message)}
          renderButton={(props) => (
            <HoverButton
              onClick={props.onClick}
              title={props.title}
              icon={props.icon}
              isActive={props.isActive}
              isLast={isLast}
            />
          )}
        />
      )}

      {/* Copy Button — see isComparison. Never hidden while a generation runs:
          copying your own question is harmless at any moment, and the vanishing
          act (opacity-0 until hover) read as «иконки куда-то пропадают» in
          every chat with a long-running answer. */}
      {!isComparison && (
        <HoverButton
          onClick={handleCopy}
          title={
            isCopied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy_to_clipboard')
          }
          icon={isCopied ? <Check className="h-[18px] w-[18px]" /> : <Copy size="19" />}
          isLast={isLast}
          className="ml-0 flex items-center gap-1.5 text-xs"
        />
      )}

      {/* Edit Button: hidden only when this message can never be edited here;
          while a generation runs it stays VISIBLE and merely disabled — a
          button that vanishes for the stream's duration looks like a bug, a
          disabled one explains itself. */}
      {isEditableEndpoint && (
        <HoverButton
          id={`edit-${message.messageId}`}
          onClick={onEdit}
          title={localize('com_ui_edit')}
          icon={<Pencil size="19" />}
          isActive={isEditing}
          isVisible={!editUnavailable}
          isDisabled={editUnavailable || isSubmitting}
          isLast={isLast}
          className={isCreatedByUser ? '' : 'active'}
        />
      )}

      {/* Fork Button */}
      <Fork
        messageId={message.messageId}
        conversationId={conversation.conversationId}
        forkingSupported={forkingSupported}
        latestMessageId={latestMessageId}
      />

      {/* Feedback Buttons */}
      {!isCreatedByUser && !isComparison && handleFeedback != null && (
        <Feedback handleFeedback={handleFeedback} feedback={message.feedback} />
      )}

      {/* Regenerate Button */}
      {regenerateEnabled && (
        <HoverButton
          onClick={regenerate}
          title={localize('com_ui_regenerate')}
          icon={<Repeat size="19" />}
          isLast={isLast}
        />
      )}

      {/* Continue Button */}
      {continueSupported && (
        <HoverButton
          onClick={(e) => e && handleContinue(e)}
          title={localize('com_ui_continue')}
          icon={<PlayerTrackNext className="w-19 h-19 -rotate-180" />}
          isLast={isLast}
        />
      )}
    </div>
  );
};

export default memo(HoverButtons);
