import { useRef, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { Button, TextareaAutosize, TooltipAnchor } from '@librechat/client';
import { useUpdateMessageMutation } from 'librechat-data-provider/react-query';
import type { TEditProps } from '~/common';
import { useMessagesOperations, useMessagesConversation } from '~/Providers';
import { useGetAddedConvo } from '~/hooks/Chat';
import { cn, removeFocusRings } from '~/utils';
import { useLocalize } from '~/hooks';
import Container from './Container';
import store from '~/store';

const EditMessage = ({
  text,
  message,
  isSubmitting,
  ask,
  enterEdit,
  siblingIdx,
  setSiblingIdx,
}: TEditProps) => {
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const { conversation } = useMessagesConversation();
  const { getMessages, setMessages } = useMessagesOperations();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const { conversationId, parentMessageId, messageId } = message;
  const updateMessageMutation = useUpdateMessageMutation(conversationId ?? '');
  const localize = useLocalize();

  const chatDirection = useRecoilValue(store.chatDirection).toLowerCase();
  const isRTL = chatDirection === 'rtl';

  const getAddedConvo = useGetAddedConvo();

  const { register, handleSubmit, setValue } = useForm({
    defaultValues: {
      text: text ?? '',
    },
  });

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (textArea) {
      const length = textArea.value.length;
      textArea.focus();
      textArea.setSelectionRange(length, length);
    }
  }, []);

  const resubmitMessage = (data: { text: string }) => {
    if (message.isCreatedByUser) {
      ask(
        {
          text: data.text,
          parentMessageId,
          conversationId,
        },
        {
          overrideFiles: message.files,
          /** Pills on the edited user message stay visible after save-and-submit;
           *  carry the picks forward so the new turn primes the same skills
           *  instead of running unprimed. */
          overrideManualSkills: message.manualSkills,
          addedConvo: getAddedConvo() || undefined,
        },
      );

      setSiblingIdx((siblingIdx ?? 0) - 1);
    } else {
      const messages = getMessages();
      const parentMessage = messages?.find((msg) => msg.messageId === parentMessageId);

      if (!parentMessage) {
        return;
      }
      ask(
        { ...parentMessage },
        {
          editedText: data.text,
          editedMessageId: messageId,
          isRegenerate: true,
          isEdited: true,
          /** Edit-assistant-response flow replays the parent user turn; keep
           *  the same manual skills so the regenerated response is primed
           *  identically. */
          overrideManualSkills: parentMessage.manualSkills,
          addedConvo: getAddedConvo() || undefined,
        },
      );

      setSiblingIdx((siblingIdx ?? 0) - 1);
    }

    enterEdit(true);
  };

  const updateMessage = (data: { text: string }) => {
    const messages = getMessages();
    if (!messages) {
      return;
    }
    updateMessageMutation.mutate({
      conversationId: conversationId ?? '',
      model: conversation?.model ?? 'gpt-3.5-turbo',
      text: data.text,
      messageId,
    });

    const isInMessages = messages.some((message) => message.messageId === messageId);
    if (!isInMessages) {
      message.text = data.text;
    } else {
      setMessages(
        messages.map((msg) =>
          msg.messageId === messageId
            ? {
                ...msg,
                text: data.text,
              }
            : msg,
        ),
      );
    }

    enterEdit(true);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitButtonRef.current?.click();
      }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveButtonRef.current?.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        enterEdit(true);
      }
    },
    [enterEdit],
  );

  const { ref, ...registerProps } = register('text', {
    required: true,
    onChange: (e) => {
      setValue('text', e.target.value, { shouldValidate: true });
    },
  });

  return (
    <Container message={message}>
      <div className="relative mt-2 flex w-full flex-grow flex-col overflow-hidden rounded-xl border border-border-light bg-surface-primary text-text-primary shadow-sm [&:has(textarea:focus)]:border-border-focus">
        <TextareaAutosize
          {...registerProps}
          ref={(e) => {
            ref(e);
            textAreaRef.current = e;
          }}
          onKeyDown={handleKeyDown}
          data-testid="message-text-editor"
          className={cn(
            'markdown prose dark:prose-invert light whitespace-pre-wrap break-words pl-3 md:pl-4',
            'm-0 w-full resize-none border-0 bg-transparent py-[10px]',
            'placeholder-text-secondary md:py-3.5',
            isRTL ? 'text-right' : 'text-left',
            'max-h-[65vh] pr-3 md:max-h-[75vh] md:pr-4',
            removeFocusRings,
          )}
          aria-label={localize('com_ui_message_input')}
          dir={isRTL ? 'rtl' : 'ltr'}
        />
      </div>
      <div className="mt-2 flex w-full flex-wrap justify-end gap-2">
        <TooltipAnchor
          description="Esc"
          render={
            <Button variant="outline" size="sm" onClick={() => enterEdit(true)}>
              {localize('com_ui_cancel')}
            </Button>
          }
        />
        <TooltipAnchor
          description="Ctrl + S / ⌘ + S"
          render={
            <Button
              ref={saveButtonRef}
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={handleSubmit(updateMessage)}
            >
              {localize('com_ui_save')}
            </Button>
          }
        />
        <TooltipAnchor
          description="Ctrl + Enter / ⌘ + Enter"
          render={
            <Button
              ref={submitButtonRef}
              variant="submit"
              size="sm"
              disabled={isSubmitting}
              onClick={handleSubmit(resubmitMessage)}
            >
              {localize('com_ui_save_submit')}
            </Button>
          }
        />
      </div>
    </Container>
  );
};

export default EditMessage;
