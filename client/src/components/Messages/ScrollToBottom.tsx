import { forwardRef } from 'react';
import { useRecoilValue } from 'recoil';
import { ChevronDown } from '~/components/icons';
import { cn, chatColumnClass } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type Props = {
  scrollHandler: React.MouseEventHandler<HTMLButtonElement>;
};

const ScrollToBottom = forwardRef<HTMLDivElement, Props>(({ scrollHandler }, ref) => {
  const localize = useLocalize();
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  return (
    /* Lives INSIDE the message scroller as a zero-height sticky rail:
       - `justify-center` centers the circle over the chat column on every
         screen (upstream #12657 right-aligned it with justify-end; on phones
         the md:-only column classes go inert and the button ended up flush
         against the right viewport edge — owner 17.08-2);
       - sticky-in-scroller (not an absolute sibling) so a swipe that starts ON
         the button still has a scrollable ancestor and pans the chat instead
         of dying (17.08-2 «заедает» hypothesis H2);
       - h-0 + items-end keep it out of layout: the rail has no height, and
         end-alignment hangs the button UPWARD from the sticky line, so no
         phantom scroll space appears below the last message. (The first
         version used an inner -translate-y-full div — with the flex default
         align-items:stretch the child's height was 0, translateY(-100%) of
         zero is zero, and the circle drew DOWNWARD with its bottom 12px cut
         by the scrollport edge; the round-12 review caught it live.)
         Transforms stay off THIS node — the scroll-animation keyframes
         animate it — and off the button — :active scales it. */
    <div
      ref={ref}
      className={cn(
        'pointer-events-none sticky z-10 mx-auto flex h-0 items-end justify-center',
        chatColumnClass(maximizeChatSpace),
      )}
      /* Р21-1: скроллпорт теперь кончается за островком композера — прежние
         фиксированные bottom-20px утонули бы под карточкой. Кнопка висит от
         живой высоты островка (--composer-h ставит ChatView). */
      style={{ bottom: 'calc(var(--composer-h, 12px) + 12px)' }}
    >
      <button
        onClick={scrollHandler}
        className="premium-scroll-button pointer-events-auto cursor-pointer focus-visible:outline-none"
        aria-label={localize('com_ui_scroll_to_bottom')}
      >
        <ChevronDown className="h-4 w-4 text-text-secondary" />
      </button>
    </div>
  );
});

ScrollToBottom.displayName = 'ScrollToBottom';

export default ScrollToBottom;
