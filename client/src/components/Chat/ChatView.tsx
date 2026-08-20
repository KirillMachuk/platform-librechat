import { memo, useCallback, useEffect, useRef } from 'react';
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
    <div className="relative flex-1 overflow-hidden overflow-y-auto overflow-x-hidden">
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
    <div className="relative flex-1 overflow-hidden overflow-y-auto overflow-x-hidden">
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

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerIslandRef = useRef<HTMLDivElement>(null);
  /* Р21-1: живая высота островка композера (растёт с текстом и файлами) —
     в --composer-h на области чата; от неё считаются нижний отступ ленты и
     позиция кнопки «вниз». */
  useEffect(() => {
    const area = chatAreaRef.current;
    const island = composerIslandRef.current;
    if (!area || !island) {
      return;
    }
    const apply = () => {
      area.style.setProperty('--composer-h', `${island.offsetHeight}px`);
      /* Лента резервирует жёлоб скроллбара (scrollbar-gutter-stable) и
         центрирует колонку в оставшейся ширине; островок живёт ВНЕ ленты и
         без того же отступа съезжал на полжёлоба вправо (те самые 4px из
         старого комментария про scrollbar-gutter-mirror). */
      const scroller = area.querySelector<HTMLElement>('[data-chat-scroller]');
      const gutter = scroller ? scroller.offsetWidth - scroller.clientWidth : 0;
      island.style.paddingRight = `${gutter}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(island);
    const scroller = area.querySelector<HTMLElement>('[data-chat-scroller]');
    if (scroller) {
      observer.observe(scroller);
    }
    return () => observer.disconnect();
  }, [isLandingPage]);

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
            <div className="relative flex h-full w-full flex-col" ref={chatAreaRef}>
              <Header />
              <>
                {isLandingPage ? (
                  <div className="flex flex-1 flex-col items-center justify-end sm:justify-center">
                    {content}
                    <div
                      /* Здесь стоял `scrollbar-gutter-mirror` — история в
                         git: он превращал обёртку в контейнер прокрутки,
                         обрезавший всплывающий выбор модели. */
                      className="w-full max-w-3xl transition-all duration-200 xl:max-w-4xl"
                    >
                      <ChatForm index={index} />
                      <ConversationStarters />
                    </div>
                  </div>
                ) : (
                  /* Р21-1 (референс ChatGPT): композер — ОСТРОВОК. Лента
                     прокрутки занимает всю высоту до низа окна, карточка
                     композера плавает поверх неё; текст читается вплотную к
                     скруглённому периметру карточки, а полоса ПОД ней
                     полупрозрачно гасит то, что уезжает под низ. Высоту
                     островка меряет ResizeObserver → --composer-h, от неё
                     живут нижний отступ ленты и кнопка «вниз». */
                  <div className="relative min-h-0 flex-1">
                    <div className="h-full">{content}</div>
                    <div
                      ref={composerIslandRef}
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col"
                    >
                      <div
                        aria-hidden="true"
                        className="composer-under-strip absolute inset-x-0 bottom-0 h-10"
                      />
                      <div className="pointer-events-auto relative w-full">
                        <ChatForm index={index} />
                      </div>
                    </div>
                  </div>
                )}
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
