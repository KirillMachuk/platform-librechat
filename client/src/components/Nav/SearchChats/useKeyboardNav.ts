import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { KeyboardEvent } from 'react';
import { buildConvoPath } from '~/utils';
import type { SearchItem } from './types';

interface Params {
  items: SearchItem[];
  onSelect: () => void;
}

export function buildSearchResultUrl(item: SearchItem): string {
  const path = buildConvoPath({
    conversationId: item.conversationId,
    projectId: item.projectId,
  });
  return item.messageId ? `${path}#msg=${item.messageId}` : path;
}

export default function useKeyboardNav({ items, onSelect }: Params) {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((current) => (current >= items.length ? 0 : current));
  }, [items]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (items.length === 0) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        setActiveIndex(items.length - 1);
        return;
      }
      if (e.key === 'Enter') {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        const item = items[activeIndex];
        if (!item || !item.conversationId) {
          return;
        }
        navigate(buildSearchResultUrl(item));
        onSelect();
      }
    },
    [items, activeIndex, navigate, onSelect],
  );

  return {
    activeId: items[activeIndex]?.id,
    onKeyDown,
  };
}
