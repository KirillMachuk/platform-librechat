import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilValue, useRecoilState } from 'recoil';
import { Search, X, SquarePen } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { OGDialog, OGDialogContent } from '@librechat/client';
import debounce from 'lodash/debounce';
import type { ChangeEvent } from 'react';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache } from '~/utils';
import useKeyboardNav from './useKeyboardNav';
import type { SearchItem } from './types';
import Results from './Results';
import store from '~/store';

const DEBOUNCE_MS = 250;
const LISTBOX_ID = 'search-chats-listbox';

const SearchChatsDialog = memo(function SearchChatsDialog() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const [open, setOpen] = useRecoilState(store.searchChatsDialogOpen);

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const debouncedSet = useMemo(
    () => debounce((value: string) => setDebounced(value), DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    return () => debouncedSet.cancel();
  }, [debouncedSet]);

  useEffect(() => {
    if (open) {
      return;
    }
    debouncedSet.cancel();
    setText('');
    setDebounced('');
    setItems([]);
  }, [open, debouncedSet]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const { activeId, onKeyDown } = useKeyboardNav({ items, onSelect: close });

  const handleNewChat = useCallback(() => {
    clearMessagesCache(queryClient, conversation?.conversationId);
    queryClient.invalidateQueries([QueryKeys.messages]);
    newConversation();
    close();
  }, [queryClient, conversation?.conversationId, newConversation, close]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setText(value);
      debouncedSet(value);
    },
    [debouncedSet],
  );

  const handleClear = useCallback(() => {
    setText('');
    setDebounced('');
    debouncedSet.cancel();
    inputRef.current?.focus();
  }, [debouncedSet]);

  const handleTrailingButton = useCallback(() => {
    if (text.length > 0) {
      handleClear();
      return;
    }
    close();
  }, [text, handleClear, close]);

  const trailingLabel =
    text.length > 0 ? localize('com_ui_clear_search') : localize('com_ui_close');

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogContent
        className="flex h-[640px] max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 supports-[height:85dvh]:max-h-[85dvh] sm:w-full"
        showCloseButton={false}
      >
        <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
          <Search className="h-5 w-5 flex-shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={text}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            placeholder={localize('com_nav_search_chats_placeholder')}
            aria-label={localize('com_nav_search_chats')}
            role="combobox"
            aria-controls={LISTBOX_ID}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            className="m-0 w-full appearance-none border-none bg-transparent p-0 text-base text-text-primary placeholder-text-secondary focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="auto"
          />
          <button
            type="button"
            onClick={handleTrailingButton}
            aria-label={trailingLabel}
            className="-mr-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
        >
          {text.trim().length === 0 ? (
            <button
              type="button"
              onClick={handleNewChat}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            >
              <SquarePen className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
              <span>{localize('com_ui_new_chat')}</span>
            </button>
          ) : null}
          <div id={LISTBOX_ID} role="listbox" aria-label={localize('com_nav_search_chats')}>
            <Results
              query={debounced}
              onSelect={close}
              scrollRoot={scrollRef}
              activeId={activeId}
              onItemsChange={setItems}
            />
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
});

export default SearchChatsDialog;
