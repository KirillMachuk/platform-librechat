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
       - h-0 + inner -translate-y-full keep it out of layout: a real height
         here would add phantom scroll space below the last message. Transforms
         stay off THIS node — the scroll-animation keyframes animate it — and
         off the button — :active scales it; only the middle div translates. */
    <div
      ref={ref}
      className={cn(
        'pointer-events-none sticky bottom-5 z-10 mx-auto flex h-0 justify-center',
        chatColumnClass(maximizeChatSpace),
      )}
    >
      <div className="-translate-y-full">
        <button
          onClick={scrollHandler}
          className="premium-scroll-button pointer-events-auto cursor-pointer focus-visible:outline-none"
          aria-label={localize('com_ui_scroll_to_bottom')}
        >
          <ChevronDown className="h-4 w-4 text-text-secondary" />
        </button>
      </div>
    </div>
  );
});

ScrollToBottom.displayName = 'ScrollToBottom';

export default ScrollToBottom;
