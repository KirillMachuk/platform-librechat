import { useCallback } from 'react';
import { PlusCircle } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { isAssistantsEndpoint } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** Index of the conversation this button belongs to; the added one is 1. */
const ROOT_INDEX = 0;

function AddMultiConvo() {
  const localize = useLocalize();
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(ROOT_INDEX));
  const setShowPlusPopover = useSetRecoilState(store.showPlusPopoverFamily(ROOT_INDEX));
  const setOpenedFromButton = useSetRecoilState(store.plusPopoverFromButtonFamily(ROOT_INDEX));

  /**
   * Opens the same picker the `+` command opens, rather than cloning the current
   * model: a second answer from the identical model is rarely what's wanted, and
   * the `+` command was the only way to choose — undiscoverable. The flag keeps the
   * picker from swallowing a draft that happens to start with `+`.
   */
  const clickHandler = useCallback(() => {
    setOpenedFromButton(true);
    setShowPlusPopover(true);
  }, [setShowPlusPopover, setOpenedFromButton]);

  if (!endpoint) {
    return null;
  }

  if (isAssistantsEndpoint(endpoint)) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_ui_add_multi_conversation')}
      role="button"
      tabIndex={0}
      aria-label={localize('com_ui_add_multi_conversation')}
      onClick={clickHandler}
      data-testid="add-multi-convo-button"
      className="tap-target inline-flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 radix-state-open:bg-surface-tertiary"
    >
      <PlusCircle className="icon-sm" aria-hidden="true" />
    </TooltipAnchor>
  );
}

export default AddMultiConvo;
