import { memo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { Constants, buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import {
  useAddedResponse,
  useResumeOnLoad,
  useAdaptiveSSE,
  useChatHelpers,
  useDefaultSelection,
} from '~/hooks';
import { ChatContext, AddedChatContext, ChatFormProvider, useFileMapContext } from '~/Providers';
import ConversationStarters from './Input/ConversationStarters';
import { useMarkActiveConversationRead } from '~/store/unread';
import { useGetMessagesByConvoId } from '~/data-provider';
import MessagesView from './Messages/MessagesView';
import Presentation from './Presentation';
import ChatForm from './Input/ChatForm';
import { useLocalize } from '~/hooks';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import { cn } from '~/utils';
import store from '~/store';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

/**
 * Отказ обязан выглядеть как отказ. Раньше при ошибке загрузки сообщений
 * `messagesTree` оставался пустым, `isLoading` уже был false, и экран навсегда
 * застревал на спиннере — даже когда сеть возвращалась.
 */
function MessagesLoadError({ onRetry }: { onRetry: () => void }) {
  const localize = useLocalize();
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-text-secondary">{localize('com_ui_messages_load_error')}</p>
        <Button variant="outline" onClick={onRetry}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);

  /* A chat you are in has nothing unseen in it. `new` is not a conversation
     yet — marking it would leave a mark under an id that never exists. */
  useMarkActiveConversationRead(
    conversationId === Constants.NEW_CONVO ? null : conversationId,
    isSubmitting,
  );

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  const fileMap = useFileMapContext();

  const {
    data: messagesTree = null,
    isLoading,
    isError: messagesFailed,
    refetch: refetchMessages,
  } = useGetMessagesByConvoId(
    conversationId ?? '',
    {
      select: useCallback(
        (data: TMessage[]) => {
          const dataTree = buildTree({ messages: data, fileMap });
          return dataTree?.length === 0 ? null : (dataTree ?? null);
        },
        [fileMap],
      ),
      enabled: !!fileMap,
    },
    { isStreaming: isSubmitting },
  );

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse();

  useDefaultSelection({
    index,
    conversationId,
    newConversation: chatHelpers.newConversation,
  });

  useAdaptiveSSE(rootSubmission, chatHelpers, false, index);

  // Auto-resume if navigating back to conversation with active job
  // Wait for messages to load before resuming to avoid race condition
  useResumeOnLoad(conversationId, chatHelpers.getMessages, index, !isLoading);

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isNavigating = (!messagesTree || messagesTree.length === 0) && conversationId != null;

  if (messagesFailed && !isLandingPage) {
    content = <MessagesLoadError onRetry={() => void refetchMessages()} />;
  } else if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if ((isLoading || isNavigating) && !isLandingPage) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="relative flex h-full w-full flex-col">
              <Header />
              <>
                <div
                  className={cn(
                    'flex flex-col',
                    isLandingPage
                      ? 'flex-1 items-center justify-end sm:justify-center'
                      : 'h-full overflow-y-auto',
                  )}
                >
                  {content}
                  <div
                    /* Здесь стоял `scrollbar-gutter-mirror` — `overflow-y: auto`
                       ради того, чтобы композер зарезервировал такую же полосу
                       прокрутки, как лента, и не уезжал на 4px. Он это делал —
                       и заодно превращал обёртку в контейнер прокрутки, который
                       ОБРЕЗАЛ всплывающий выбор модели: кнопка «сравнить с
                       другой моделью» открывала меню, которого не видно. Резерв
                       полосы без контейнера прокрутки средствами CSS не
                       выражается, поэтому 4px возвращаются до отдельного
                       решения — меню важнее. */
                    className={cn(
                      'w-full',
                      isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                    )}
                  >
                    <ChatForm index={index} />
                    {isLandingPage && <ConversationStarters />}
                  </div>
                </div>
                {/* Дисклеймер живёт ТОЛЬКО на пустом «Новом чате» (владелец
                    14.08-4): первое же сообщение снимает лендинг — и надпись с
                    ним; в диалогах её больше нет. На телефоне как и раньше
                    скрыт (hidden sm:flex внутри Footer). Прижат к низу экрана
                    absolute-позицией от этого relative-контейнера. */}
                {isLandingPage && <Footer />}
              </>
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
