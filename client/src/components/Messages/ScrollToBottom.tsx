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
    <div
      ref={ref}
      className={cn(
        'pointer-events-none absolute bottom-5 left-0 right-0 mx-auto flex justify-end',
        chatColumnClass(maximizeChatSpace),
      )}
    >
      <button
        onClick={scrollHandler}
        className="premium-scroll-button pointer-events-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
        aria-label={localize('com_ui_scroll_to_bottom')}
      >
        <ChevronDown className="h-4 w-4 text-text-secondary" />
      </button>
    </div>
  );
});

ScrollToBottom.displayName = 'ScrollToBottom';

export default ScrollToBottom;
