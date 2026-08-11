import { useCallback } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { isAssistantsEndpoint } from 'librechat-data-provider';
import { PlusCircle } from '~/components/icons';
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
      /* Канон §7: на телефоне кнопка-иконка шапки сама 44; §6.2: на десктопе 32.
         Тот же случай, что у TemporaryChat — компонент стоит в общей группе
         шапки и рендерится на обеих ширинах. */
      className="tap-target inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 radix-state-open:bg-surface-tertiary md:h-8 md:w-8"
    >
      <PlusCircle className="icon-sm" aria-hidden="true" />
    </TooltipAnchor>
  );
}

export default AddMultiConvo;
