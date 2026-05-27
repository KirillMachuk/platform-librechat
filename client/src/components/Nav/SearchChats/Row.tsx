import { memo, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface SearchChatsRowProps {
  variant?: 'full' | 'icon';
}

const SearchChatsRow = memo(function SearchChatsRow({ variant = 'full' }: SearchChatsRowProps) {
  const localize = useLocalize();
  const search = useRecoilValue(store.search);
  const setOpen = useSetRecoilState(store.searchChatsDialogOpen);
  const openDialog = useCallback(() => setOpen(true), [setOpen]);

  useEffect(() => {
    if (search.enabled !== true) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search.enabled, setOpen]);

  if (search.enabled !== true) {
    return null;
  }

  const label = localize('com_nav_search_chats');

  if (variant === 'icon') {
    return (
      <TooltipAnchor
        side="right"
        description={label}
        render={
          <button
            type="button"
            data-testid="search-chats-icon-button"
            aria-label={label}
            onClick={openDialog}
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
          >
            <Search className="h-5 w-5 text-text-primary" aria-hidden="true" />
          </button>
        }
      />
    );
  }

  return (
    <button
      type="button"
      data-testid="search-chats-button"
      aria-label={label}
      onClick={openDialog}
      className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
    >
      <Search className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
});

export default SearchChatsRow;
