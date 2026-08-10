import { memo, useEffect, useCallback } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import {
  sidebarIconButtonClassName,
  sidebarRowIconClassName,
  sidebarRowClassName,
} from '~/components/UnifiedSidebar/rows';
import { Search } from '~/components/icons';
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
            className={sidebarIconButtonClassName}
          >
            <Search className="icon-md" aria-hidden="true" />
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
      className={sidebarRowClassName}
    >
      <Search className={sidebarRowIconClassName} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
});

export default SearchChatsRow;
