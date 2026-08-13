import { useState, useId, useMemo, useCallback, memo } from 'react';
import * as Ariakit from '@ariakit/react';
import { DropdownPopup, TooltipAnchor } from '@librechat/client';
import type { FC } from 'react';
import type * as t from '~/common';
import { headerIconButtonClassName } from '~/components/Conversations/Conversations';
import { Bookmark, BookmarkFilled, XCircle } from '~/components/icons';
import { useGetConversationTags } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type BookmarkNavProps = {
  tags: string[];
  setTags: (tags: string[]) => void;
};

const BookmarkNav: FC<BookmarkNavProps> = ({ tags, setTags }: BookmarkNavProps) => {
  const localize = useLocalize();
  const menuId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { data } = useGetConversationTags();

  const label = useMemo(
    () => (tags.length > 0 ? tags.join(', ') : localize('com_ui_bookmarks')),
    [tags, localize],
  );

  const buttonAriaLabel = useMemo(() => {
    if (tags.length === 0) {
      return localize('com_ui_bookmarks');
    }
    return localize('com_ui_bookmarks_count_selected', { count: tags.length });
  }, [tags.length, localize]);

  const bookmarks = useMemo(() => data?.filter((tag) => tag.count > 0) ?? [], [data]);

  const handleTagClick = useCallback(
    (tag: string) => {
      if (tags.includes(tag)) {
        setTags(tags.filter((t) => t !== tag));
      } else {
        setTags([...tags, tag]);
      }
    },
    [tags, setTags],
  );

  const handleClear = useCallback(() => {
    setTags([]);
  }, [setTags]);

  const dropdownItems: t.MenuItemProps[] = useMemo(() => {
    const items: t.MenuItemProps[] = [
      {
        id: 'clear-all',
        label: localize('com_ui_clear_all'),
        icon: <XCircle className="size-4" aria-hidden="true" />,
        hideOnClick: false,
        onClick: handleClear,
      },
    ];

    if (bookmarks.length === 0) {
      items.push({
        id: 'no-bookmarks',
        label: localize('com_ui_no_bookmarks'),
        icon: '🤔',
        disabled: true,
      });
    } else {
      for (const bookmark of bookmarks) {
        const isSelected = tags.includes(bookmark.tag);
        items.push({
          id: bookmark.tag,
          label: bookmark.tag,
          hideOnClick: false,
          icon: isSelected ? (
            <BookmarkFilled className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          ),
          onClick: () => handleTagClick(bookmark.tag),
          ariaChecked: isSelected,
        });
      }
    }

    return items;
  }, [bookmarks, tags, localize, handleTagClick, handleClear]);

  return (
    <DropdownPopup
      portal={true}
      menuId={menuId}
      focusLoop={true}
      isOpen={isMenuOpen}
      unmountOnHide={true}
      setIsOpen={setIsMenuOpen}
      keyPrefix="bookmark-nav-"
      className="z-popover"
      trigger={
        <TooltipAnchor
          description={label}
          render={
            <Ariakit.MenuButton
              id="bookmark-nav-menu-button"
              aria-label={buttonAriaLabel}
              aria-pressed={tags.length > 0}
              className={cn(
                headerIconButtonClassName,
                isMenuOpen || tags.length > 0 ? 'bg-surface-active-alt text-text-primary' : '',
              )}
              data-testid="bookmark-nav"
            >
              {tags.length > 0 ? (
                <BookmarkFilled aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Bookmark aria-hidden="true" className="h-4 w-4" />
              )}
            </Ariakit.MenuButton>
          }
        />
      }
      items={dropdownItems}
    />
  );
};

/** Memoized upstream (#14011) to keep it out of the re-render storm while a reply streams. */
export default memo(BookmarkNav);
