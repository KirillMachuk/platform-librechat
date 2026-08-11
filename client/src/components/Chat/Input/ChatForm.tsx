import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { TextareaAutosize } from '@librechat/client';
import { useRecoilState, useRecoilValue } from 'recoil';
import {
  Constants,
  isReasoningModel,
  isAgentsEndpoint,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter, ConvoGenerator } from '~/common';
import {
  useTextarea,
  useAutoSave,
  useLocalize,
  useRequiresKey,
  useHandleKeyUp,
  useQueryParams,
  useSubmitMessage,
  useFocusChatEffect,
} from '~/hooks';
import {
  useChatContext,
  useChatFormContext,
  useAddedChatContext,
  useAssistantsMapContext,
} from '~/Providers';
import { cn, chatColumnClass, getModelSpec, removeFocusRings, modelReportsNoTools } from '~/utils';
import { useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import PendingManualSkillsChips from './PendingManualSkillsChips';
import { mainTextareaId, BadgeItem } from '~/common';
import AttachFileChat from './Files/AttachFileChat';
import FileFormChat from './Files/FileFormChat';
import TextareaHeader from './TextareaHeader';
import PromptsCommand from './PromptsCommand';
import SkillsCommand from './SkillsCommand';
import AudioRecorder from './AudioRecorder';
import CollapseChat from './CollapseChat';
import StreamAudio from './StreamAudio';
import TokenUsage from './TokenUsage';
import StopButton from './StopButton';
import SendButton from './SendButton';
import EditBadges from './EditBadges';
import BadgeRow from './BadgeRow';
import Mention from './Mention';
import store from '~/store';

interface ChatFormProps {
  index: number;
  placeholder?: string;
  /** From ChatContext — individual values so memo can compare them */
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  conversation: TConversation | null;
  isSubmitting: boolean;
  filesLoading: boolean;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  newConversation: ConvoGenerator;
  handleStopGenerating: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const ChatForm = memo(function ChatForm({
  index,
  placeholder,
  files,
  setFiles,
  conversation,
  isSubmitting,
  filesLoading,
  setFilesLoading,
  newConversation,
  handleStopGenerating,
}: ChatFormProps) {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useFocusChatEffect(textAreaRef);
  const localize = useLocalize();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, setIsScrollable] = useState(false);
  const [visualRowCount, setVisualRowCount] = useState(1);
  const [backupBadges, setBackupBadges] = useState<Pick<BadgeItem, 'id'>[]>([]);

  const SpeechToText = useRecoilValue(store.speechToText);
  const TextToSpeech = useRecoilValue(store.textToSpeech);
  const chatDirection = useRecoilValue(store.chatDirection);
  const automaticPlayback = useRecoilValue(store.automaticPlayback);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const isTemporary = useRecoilValue(store.isTemporary);

  const [badges, setBadges] = useRecoilState(store.chatBadges);
  const [isEditingBadges, setIsEditingBadges] = useRecoilState(store.isEditingBadges);
  const [showStopButton, setShowStopButton] = useRecoilState(store.showStopButtonByIndex(index));
  const plusPopoverAtom = useMemo(() => store.showPlusPopoverFamily(index), [index]);
  const plusPopoverFromButton = useRecoilValue(store.plusPopoverFromButtonFamily(index));
  const mentionPopoverAtom = useMemo(() => store.showMentionPopoverFamily(index), [index]);

  const { requiresKey } = useRequiresKey();
  const methods = useChatFormContext();
  const {
    generateConversation,
    conversation: addedConvo,
    setConversation: setAddedConvo,
  } = useAddedChatContext();
  const assistantMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();

  const endpoint = useMemo(
    () => conversation?.endpointType ?? conversation?.endpoint,
    [conversation?.endpointType, conversation?.endpoint],
  );
  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );
  const hideBadgeRow = modelSpec?.hideBadgeRow === true;
  /** Two kinds of model run chat-only and cannot work the multi-turn tool loop, so
   *  the toggles that arm one are hidden for both. Reasoning models (o-series /
   *  gpt-5.x) are recognised by name, mirroring the backend, which drops those
   *  tools for the same models via the shared predicate. The second kind is any
   *  model whose gateway publishes no `tools` support: it accepts the definitions
   *  and ignores them, so a visible toggle would promise a search that never
   *  happens. Deep Research and Artifacts stay in both cases: DR runs on its own
   *  lead and worker models from the config, and Artifacts is not a tool. The model
   *  read here is the one the backend sees for the ephemeral agent. */
  const toolLoopUnavailable = useMemo(
    () =>
      isReasoningModel(conversation?.model) ||
      modelReportsNoTools(endpointsConfig, conversation?.endpoint, conversation?.model),
    [conversation?.model, conversation?.endpoint, endpointsConfig],
  );
  const conversationId = useMemo(
    () => conversation?.conversationId ?? Constants.NEW_CONVO,
    [conversation?.conversationId],
  );

  const isRTL = useMemo(
    () => (chatDirection != null ? chatDirection?.toLowerCase() === 'rtl' : false),
    [chatDirection],
  );
  const invalidAssistant = useMemo(
    () =>
      isAssistantsEndpoint(endpoint) &&
      (!(conversation?.assistant_id ?? '') ||
        !assistantMap?.[endpoint ?? '']?.[conversation?.assistant_id ?? '']),
    [conversation?.assistant_id, endpoint, assistantMap],
  );
  const disableInputs = useMemo(
    () => requiresKey || invalidAssistant,
    [requiresKey, invalidAssistant],
  );

  const handleContainerClick = useCallback(() => {
    /** Check if the device is a touchscreen */
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }
    textAreaRef.current?.focus();
  }, []);

  const handleFocusOrClick = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isCollapsed]);

  useAutoSave({
    files,
    setFiles,
    textAreaRef,
    conversationId,
    isSubmitting,
  });

  const { submitMessage, submitPrompt } = useSubmitMessage();

  const handleKeyUp = useHandleKeyUp({
    index,
    textAreaRef,
  });
  const {
    isNotAppendable,
    handlePaste,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextarea({
    textAreaRef,
    submitButtonRef,
    setIsScrollable,
    disabled: disableInputs,
    placeholder,
  });

  useQueryParams({ textAreaRef });

  const { ref, ...registerProps } = methods.register('text', {
    required: true,
    onChange: useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        methods.setValue('text', e.target.value, { shouldValidate: true }),
      [methods],
    ),
  });

  const textValue = useWatch({ control: methods.control, name: 'text' });

  useEffect(() => {
    if (textAreaRef.current) {
      const style = window.getComputedStyle(textAreaRef.current);
      const lineHeight = parseFloat(style.lineHeight);
      setVisualRowCount(Math.floor(textAreaRef.current.scrollHeight / lineHeight));
    }
  }, [textValue]);

  useEffect(() => {
    if (isEditingBadges && backupBadges.length === 0) {
      setBackupBadges([...badges]);
    }
  }, [isEditingBadges, badges, backupBadges.length]);

  const handleSaveBadges = useCallback(() => {
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [setIsEditingBadges, setBackupBadges]);

  const handleCancelBadges = useCallback(() => {
    if (backupBadges.length > 0) {
      setBadges([...backupBadges]);
    }
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [backupBadges, setBadges, setIsEditingBadges]);

  const isMoreThanThreeRows = visualRowCount > 3;

  const baseClasses = useMemo(
    () =>
      cn(
        /* text-base, not the inherited 14: canon §6.13 sets the composer at
           16px on every width (16 is also what stops iOS zooming the page on
           focus). The book's box draws its placeholder at 16/25.6 in t3, so
           the leading and the placeholder colour are the book's numbers, not
           an alpha blend of the theme's ink. Geometry is the book's too: the
           box padding is 12px 10px 8px 16px (d02, measured), so the text
           starts 16 from the left, 12 from the top, 10 from the right. */
        'm-0 w-full resize-none pt-3 pb-1.5 text-base leading-[1.6] placeholder:text-text-tertiary bg-transparent',
        /* Resting height (owner 11.08-3, Kimi as the yardstick — its box is
           ~768×130): the desktop text zone holds min 84, which with the 34px
           button row, its 10px bottom pad and the 2px of border lands the box
           at 130. The phone keeps the single 44 row. Collapse wins: an
           unconditional min would hold the collapsed box open. */
        isCollapsed ? 'max-h-[52px]' : 'max-h-[45vh] md:min-h-[84px] md:max-h-[55vh]',
        isMoreThanThreeRows ? 'ps-3.5 md:ps-4' : 'ps-3.5 pe-2 md:ps-4 md:pe-2.5',
      ),
    [isCollapsed, isMoreThanThreeRows],
  );

  return (
    <form
      onSubmit={methods.handleSubmit(submitMessage)}
      className={cn(
        'mx-auto flex w-full flex-row gap-3 px-2.5 pb-[calc(14px+env(safe-area-inset-bottom,0px))] transition-[max-width] duration-300 sm:pb-0 md:px-0',
        chatColumnClass(maximizeChatSpace),
        centerFormOnLanding &&
          (conversationId == null || conversationId === Constants.NEW_CONVO) &&
          !isSubmitting &&
          conversation?.messages?.length === 0
          ? 'transition-all duration-200 sm:mb-28'
          : 'sm:mb-10',
      )}
    >
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <div className={cn('flex w-full items-center', isRTL && 'flex-row-reverse')}>
          <Mention
            index={index}
            popoverAtom={plusPopoverAtom}
            newConversation={generateConversation}
            textAreaRef={textAreaRef}
            commandChar="+"
            placeholder="com_ui_add_model_preset"
            includeAssistants={false}
            adoptComposerText={!plusPopoverFromButton}
          />
          <Mention
            index={index}
            popoverAtom={mentionPopoverAtom}
            newConversation={newConversation}
            textAreaRef={textAreaRef}
          />
          <PromptsCommand index={index} textAreaRef={textAreaRef} submitPrompt={submitPrompt} />
          <SkillsCommand
            index={index}
            textAreaRef={textAreaRef}
            conversationId={conversationId}
            agentId={conversation?.agent_id}
          />
          <div
            onClick={handleContainerClick}
            data-testid="composer-shell"
            className={cn(
              // Owner's decision 11.08, an exception to the §1.8 field recipe:
              // the composer wears the login card's dress — hairline border and
              // the sm shadow token — and does NOT react to focus or typing.
              // The only thing that answers input is the send button's icon.
              // Keyboard focus is shown by the caret alone; the global focus
              // canon already exempts textareas from the outline.
              'relative flex w-full flex-grow flex-col overflow-hidden rounded-3xl border shadow-sm transition-colors duration-90',
              'text-text-primary',
              isTemporary
                ? 'border-violet-800/60 bg-violet-950/10'
                : 'border-border-light bg-surface-chat',
            )}
          >
            <TextareaHeader addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
            <PendingManualSkillsChips conversationId={conversationId} />
            {/* WIP */}
            <EditBadges
              isEditingChatBadges={isEditingBadges}
              handleCancelBadges={handleCancelBadges}
              handleSaveBadges={handleSaveBadges}
              setBadges={setBadges}
            />
            <FileFormChat
              conversation={conversation}
              files={files}
              setFiles={setFiles}
              setFilesLoading={setFilesLoading}
            />
            {endpoint && (
              <div className={cn('flex', isRTL ? 'flex-row-reverse' : 'flex-row')}>
                <div
                  className="relative flex-1"
                  style={
                    isCollapsed
                      ? {
                          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                          maskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                        }
                      : undefined
                  }
                >
                  <TextareaAutosize
                    {...registerProps}
                    ref={(e) => {
                      ref(e);
                      (textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
                        e;
                    }}
                    disabled={disableInputs || isNotAppendable}
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    id={mainTextareaId}
                    tabIndex={0}
                    data-testid="text-input"
                    rows={1}
                    onFocus={handleFocusOrClick}
                    aria-label={localize('com_ui_message_input')}
                    onClick={handleFocusOrClick}
                    style={{ height: 44, overflowY: 'auto' }}
                    className={cn(
                      baseClasses,
                      removeFocusRings,
                      'scrollbar-hover transition-[max-height] duration-200 disabled:cursor-not-allowed',
                    )}
                  />
                </div>
                <div className="flex flex-col items-start justify-start pr-2.5 pt-1.5">
                  <CollapseChat
                    isCollapsed={isCollapsed}
                    isScrollable={isMoreThanThreeRows}
                    setIsCollapsed={setIsCollapsed}
                  />
                </div>
              </div>
            )}
            <div
              className={cn(
                /* The book's OPTICAL row offsets, measured on d02/m02 with the
                   1px box border included: first button lands at 9 (desktop)
                   / 7 (phone) from the box edge, send ends 11 / 9 from the
                   right, the row sits 11 / 9 above the bottom. Logical props,
                   so RTL mirrors without per-child conditionals. */
                '@container items-between flex gap-2 pb-2 pe-2 ps-1.5 md:pb-2.5 md:pe-2.5 md:ps-2',
                isRTL ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              {/* Desktop keeps its own attach trigger; on the phone the «+»
                  sheet inside BadgeRow is the one entry point for uploads AND
                  tools (book: no separate tools button below md). */}
              <div className="hidden md:block">
                <AttachFileChat
                  conversation={conversation}
                  disableInputs={disableInputs}
                  files={files}
                  setFiles={setFiles}
                  setFilesLoading={setFilesLoading}
                />
              </div>
              <BadgeRow
                showEphemeralBadges={
                  !!endpoint &&
                  !hideBadgeRow &&
                  !isAgentsEndpoint(endpoint) &&
                  !isAssistantsEndpoint(endpoint)
                }
                isSubmitting={isSubmitting}
                conversationId={conversationId}
                specName={conversation?.spec}
                toolLoopUnavailable={toolLoopUnavailable}
                activeModel={conversation?.model}
                onChange={setBadges}
                isInChat={
                  Array.isArray(conversation?.messages) && conversation.messages.length >= 1
                }
                plusSheet={{
                  conversation,
                  disableInputs,
                  files,
                  setFiles,
                  setFilesLoading,
                }}
              />
              <div className="mx-auto flex" />
              <TokenUsage index={index} conversation={conversation} isSubmitting={isSubmitting} />
              {SpeechToText && (
                <AudioRecorder
                  methods={methods}
                  ask={submitMessage}
                  disabled={disableInputs || isNotAppendable}
                  isSubmitting={isSubmitting}
                />
              )}
              <div>
                {isSubmitting && showStopButton ? (
                  <StopButton stop={handleStopGenerating} setShowStopButton={setShowStopButton} />
                ) : (
                  endpoint && (
                    <SendButton
                      ref={submitButtonRef}
                      control={methods.control}
                      disabled={filesLoading || isSubmitting || disableInputs || isNotAppendable}
                    />
                  )
                )}
              </div>
            </div>
            {TextToSpeech && automaticPlayback && <StreamAudio index={index} />}
          </div>
        </div>
      </div>
    </form>
  );
});
ChatForm.displayName = 'ChatForm';

/**
 * Wrapper that subscribes to ChatContext and passes stable individual values
 * to the memo'd ChatForm. This prevents ChatForm from re-rendering on every
 * streaming chunk — it only re-renders when the specific values it uses change.
 */
function ChatFormWrapper({ index = 0, placeholder }: { index?: number; placeholder?: string }) {
  const {
    files,
    setFiles,
    conversation,
    isSubmitting,
    filesLoading,
    setFilesLoading,
    newConversation,
    handleStopGenerating,
  } = useChatContext();

  /**
   * Stabilize conversation reference: only update when rendering-relevant fields change,
   * not on every metadata update (e.g., title generation during streaming).
   */
  const hasMessages = (conversation?.messages?.length ?? 0) > 0;
  const stableConversation = useMemo(
    () => conversation,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      conversation?.conversationId,
      conversation?.endpoint,
      conversation?.endpointType,
      conversation?.agent_id,
      conversation?.assistant_id,
      conversation?.spec,
      conversation?.useResponsesApi,
      conversation?.model,
      conversation?.maxContextTokens,
      hasMessages,
    ],
  );

  /** Stabilize function refs so they never trigger ChatForm re-renders */
  const handleStopRef = useRef(handleStopGenerating);
  handleStopRef.current = handleStopGenerating;
  const stableHandleStop = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => handleStopRef.current(e),
    [],
  );

  const newConvoRef = useRef(newConversation);
  newConvoRef.current = newConversation;
  const stableNewConversation: ConvoGenerator = useCallback(
    (...args: Parameters<ConvoGenerator>): ReturnType<ConvoGenerator> =>
      newConvoRef.current(...args),
    [],
  );

  return (
    <ChatForm
      index={index}
      placeholder={placeholder}
      files={files}
      setFiles={setFiles}
      conversation={stableConversation}
      isSubmitting={isSubmitting}
      filesLoading={filesLoading}
      setFilesLoading={setFilesLoading}
      newConversation={stableNewConversation}
      handleStopGenerating={stableHandleStop}
    />
  );
}

ChatFormWrapper.displayName = 'ChatFormWrapper';

export default ChatFormWrapper;
