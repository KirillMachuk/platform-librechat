import { useState, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import { CSSTransition } from 'react-transition-group';
import type { TMessage } from 'librechat-data-provider';
import { useScreenshot, useMessageScrolling, useScrollToMessage, useLocalize } from '~/hooks';
import ScrollToBottom from '~/components/Messages/ScrollToBottom';
import { MessagesViewProvider } from '~/Providers';
import { fontSizeAtom } from '~/store/fontSize';
import MultiMessage from './MultiMessage';
import MessageNav from './MessageNav';
import { cn } from '~/utils';
import store from '~/store';

function MessagesViewContent({
  messagesTree: _messagesTree,
}: {
  messagesTree?: TMessage[] | null;
}) {
  const localize = useLocalize();
  const fontSize = useAtomValue(fontSizeAtom);
  const { screenshotTargetRef } = useScreenshot();
  const scrollButtonPreference = useRecoilValue(store.showScrollButton);
  const [currentEditId, setCurrentEditId] = useState<number | string | null>(-1);
  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  const {
    conversation,
    contentRef,
    scrollableRef,
    messagesEndRef,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  } = useMessageScrolling(_messagesTree);

  const { conversationId } = conversation ?? {};
  const isMessagesReady = Array.isArray(_messagesTree) && _messagesTree.length > 0;
  useScrollToMessage(isMessagesReady);

  return (
    <>
      <div className="relative flex-1 overflow-hidden overflow-y-auto overflow-x-hidden">
        <div className="relative h-full">
          <div
            className="scrollbar-gutter-stable"
            data-chat-scroller
            onScroll={debouncedHandleScroll}
            ref={scrollableRef}
            style={{
              height: '100%',
              overflowY: 'auto',
              /* 17.08-1: без прибитой поперечной оси мак-трекпад упруго возил
                 ВСЮ ленту вбок (bounce по вычисленному overflow-x:auto). */
              overflowX: 'hidden',
              width: '100%',
            }}
          >
            {/*
              Лента объявлена журналом: без этого незрячий человек не узнаёт,
              что ответ пришёл — новые сообщения появлялись молча. `polite`, а
              не `assertive`, чтобы не перебивать чтение; `aria-relevant`
              ограничен добавлениями, иначе диктор зачитывает и удаления.
            */}
            <div
              ref={contentRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={localize('com_ui_conversation_log')}
              className="flex flex-col pt-14 dark:bg-transparent"
              /* Р21-1: скроллер тянется ПОД островок композера до низа окна —
                 нижний отступ контента равен живой высоте островка (ChatView
                 меряет её ResizeObserver'ом в --composer-h) плюс воздух, чтобы
                 покоящаяся лента не пряталась под карточкой. */
              style={{ paddingBottom: 'calc(var(--composer-h, 12px) + 24px)' }}
            >
              {(_messagesTree && _messagesTree.length == 0) || _messagesTree === null ? (
                <div
                  className={cn(
                    'flex w-full items-center justify-center p-3 text-text-secondary',
                    fontSize,
                  )}
                >
                  {localize('com_ui_nothing_found')}
                </div>
              ) : (
                <>
                  <div ref={screenshotTargetRef}>
                    <MultiMessage
                      messagesTree={_messagesTree}
                      messageId={conversationId ?? null}
                      setCurrentEditId={setCurrentEditId}
                      currentEditId={currentEditId ?? null}
                    />
                  </div>
                </>
              )}
              <div
                id="messages-end"
                className="group h-0 w-full flex-shrink-0"
                ref={messagesEndRef}
              />
            </div>

            {/* Inside the scroller on purpose: as an absolute SIBLING the
                button was a dead zone for touch — a swipe starting on it had
                no scrollable ancestor and moved nothing (17.08-2). Sticky
                keeps it pinned 20px above the scrollport bottom. */}
            <CSSTransition
              in={showScrollButton && scrollButtonPreference}
              timeout={{
                enter: 300,
                exit: 250,
              }}
              classNames="scroll-animation"
              unmountOnExit={true}
              appear={true}
              nodeRef={scrollToBottomRef}
            >
              <ScrollToBottom ref={scrollToBottomRef} scrollHandler={handleSmoothToRef} />
            </CSSTransition>
          </div>

          <MessageNav scrollableRef={scrollableRef} />
        </div>
      </div>
    </>
  );
}

export default function MessagesView({ messagesTree }: { messagesTree?: TMessage[] | null }) {
  return (
    <MessagesViewProvider>
      <MessagesViewContent messagesTree={messagesTree} />
    </MessagesViewProvider>
  );
}
