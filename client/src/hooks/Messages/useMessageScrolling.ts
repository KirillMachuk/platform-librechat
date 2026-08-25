import { useState, useRef, useCallback, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useMessagesConversation, useMessagesSubmission } from '~/Providers';
import { reconcileMessageContentLayout } from './messageLayout';
import useScrollToRef from '~/hooks/useScrollToRef';
import store from '~/store';

const threshold = 0.85;
const debounceRate = 150;
const resizeFollowThreshold = 120;

export default function useMessageScrolling(messagesTree?: TMessage[] | null) {
  const autoScroll = useRecoilValue(store.autoScroll);

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const suppressNextResizeFollowRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { conversation, conversationId } = useMessagesConversation();
  const { setAbortScroll, isSubmitting, abortScroll } = useMessagesSubmission();

  const timeoutIdRef = useRef<NodeJS.Timeout>();

  const getIsNearBottom = useCallback(() => {
    const scrollEl = scrollableRef.current;
    if (!scrollEl) {
      return true;
    }
    const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    return distance <= resizeFollowThreshold;
  }, []);

  const debouncedSetShowScrollButton = useCallback((value: boolean) => {
    clearTimeout(timeoutIdRef.current);
    timeoutIdRef.current = setTimeout(() => {
      setShowScrollButton(value);
    }, debounceRate);
  }, []);

  useEffect(() => {
    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = entry.isIntersecting;
        debouncedSetShowScrollButton(!entry.isIntersecting);
        /* The user came back to the bottom on their own — resume following,
         * exactly as the scroll-to-bottom button click does. Without this,
         * a wheel/touch anywhere over messages set abortScroll for the rest
         * of the stream and only the button could re-attach the follow
         * (round 24 audit: «вернулся вниз колесом — лента всё равно стоит»). */
        if (entry.isIntersecting) {
          setAbortScroll(false);
        }
      },
      { root: scrollableRef.current, threshold },
    );

    observer.observe(messagesEndRef.current);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutIdRef.current);
    };
  }, [messagesEndRef, scrollableRef, debouncedSetShowScrollButton, setAbortScroll]);

  /* The mount effect above owns THE IntersectionObserver — and the BUTTON.
     This used to build a NEW observer on every scroll event and return a
     cleanup nobody calls (onScroll discards return values) — hundreds piled
     up while swiping a long history and every threshold crossing fired them
     all, dropping frames on the phone (17.08-2 «заедает», hypothesis H4).
     The handler refreshes only the follow-threshold ref: writing the button
     here too made two writers with different thresholds (120px follow vs the
     observer's crossing) race on every flick and flicker the button — the
     round-12 review caught the non-monotonic hand-off. */
  const debouncedHandleScroll = useCallback(() => {
    isNearBottomRef.current = getIsNearBottom();
  }, [getIsNearBottom]);

  const scrollCallback = () => {
    reconcileMessageContentLayout(scrollableRef.current);
    isNearBottomRef.current = true;
    debouncedSetShowScrollButton(false);
  };

  const { scrollToRef: scrollToBottom, handleSmoothToRef } = useScrollToRef({
    targetRef: messagesEndRef,
    callback: scrollCallback,
    smoothCallback: () => {
      scrollCallback();
      setAbortScroll(false);
    },
  });

  const clampScrollToContent = useCallback(() => {
    const scrollEl = scrollableRef.current;
    if (!scrollEl) {
      return false;
    }

    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    if (scrollEl.scrollTop <= maxScrollTop) {
      return false;
    }

    scrollEl.scrollTop = maxScrollTop;
    isNearBottomRef.current = getIsNearBottom();
    return true;
  }, [getIsNearBottom]);

  const reconcileContentResize = useCallback(
    (shouldFollowResize = true) => {
      if (clampScrollToContent()) {
        return;
      }

      if (suppressNextResizeFollowRef.current) {
        suppressNextResizeFollowRef.current = false;
        isNearBottomRef.current = getIsNearBottom();
        return;
      }

      /* Self-heal on growth: wheeling down AT the bottom still trips the
       * wheel handler's abortScroll, and the IntersectionObserver only fires
       * on crossings — so if the sentinel never left the viewport nothing
       * would clear the abort. STRICTLY at the bottom only (not the 120px
       * follow band): a gentle upward wheel tick moves ~60-100px and must
       * detach the follow — healing inside the band would snap the user
       * straight back down (independent review, round 24). */
      const scrollEl = scrollableRef.current;
      const distance =
        scrollEl == null ? 0 : scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (isSubmitting && abortScroll === true && distance <= 8) {
        setAbortScroll(false);
      }

      if (shouldFollowResize && isSubmitting && abortScroll !== true && isNearBottomRef.current) {
        scrollToBottom?.();
      }
    },
    [
      abortScroll,
      clampScrollToContent,
      getIsNearBottom,
      isSubmitting,
      scrollToBottom,
      setAbortScroll,
    ],
  );

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => reconcileContentResize());
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [reconcileContentResize]);

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) {
      return;
    }

    const suppressNextResizeFollow = () => {
      suppressNextResizeFollowRef.current = true;
    };

    contentEl.addEventListener('pointerdown', suppressNextResizeFollow, true);
    contentEl.addEventListener('keydown', suppressNextResizeFollow, true);
    return () => {
      contentEl.removeEventListener('pointerdown', suppressNextResizeFollow, true);
      contentEl.removeEventListener('keydown', suppressNextResizeFollow, true);
    };
  }, []);

  useEffect(() => {
    if (!messagesTree || messagesTree.length === 0) {
      return;
    }

    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    // `abortScroll` поднимается только колесом и касанием. Кто тянул ползунок
    // прокрутки или шёл клавишами, его не выставлял — и лента дёргала человека
    // обратно вниз на каждом куске ответа. Обработчик изменения размера рядом
    // (см. `reconcileContentResize`) уже спрашивает, у низа ли мы; спрашиваем и
    // здесь, чтобы правило было одно.
    if (isSubmitting && scrollToBottom && abortScroll !== true && isNearBottomRef.current) {
      scrollToBottom();
    }

    return () => {
      if (abortScroll === true) {
        scrollToBottom && scrollToBottom.cancel();
      }
    };
  }, [isSubmitting, messagesTree, scrollToBottom, abortScroll]);

  useEffect(() => {
    if (!messagesEndRef.current || !scrollableRef.current) {
      return;
    }

    if (scrollToBottom && autoScroll && conversationId !== Constants.NEW_CONVO) {
      scrollToBottom();
    }
  }, [autoScroll, conversationId, scrollToBottom]);

  /* The scroll-to-bottom button. While a reply is streaming, the smooth
   * glide is a lie: smoothCallback re-opens the follow gates immediately and
   * the next chunk's instant follow (<=145ms) teleports over the animation —
   * the user sees a started glide cut by a jump. Streaming clicks therefore
   * jump instantly (predictable, ChatGPT-like); idle clicks keep the glide. */
  const handleScrollButtonClick: React.MouseEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (isSubmitting) {
        setAbortScroll(false);
        scrollToBottom?.();
        return;
      }
      handleSmoothToRef(e);
    },
    [isSubmitting, scrollToBottom, handleSmoothToRef, setAbortScroll],
  );

  return {
    conversation,
    contentRef,
    scrollableRef,
    messagesEndRef,
    scrollToBottom,
    showScrollButton,
    handleScrollButtonClick,
    debouncedHandleScroll,
  };
}
