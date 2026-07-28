import { memo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare, MessageSquare } from 'lucide-react';
import type { MouseEvent } from 'react';
import { buildSearchResultUrl } from './url';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ItemProps {
  id: string;
  conversationId: string;
  projectId?: string;
  title: string;
  snippet?: string;
  rightLabel?: string;
  messageId?: string;
  type?: 'recent' | 'chat' | 'message';
  isActive?: boolean;
  onSelect?: () => void;
}

const Item = memo(function Item({
  id,
  conversationId,
  projectId,
  title,
  snippet,
  rightLabel,
  messageId,
  type = 'recent',
  isActive = false,
  onSelect,
}: ItemProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (!conversationId) {
        return;
      }
      navigate(buildSearchResultUrl({ conversationId, projectId, messageId }));
      onSelect?.();
    },
    [conversationId, projectId, messageId, navigate, onSelect],
  );

  useEffect(() => {
    if (!isActive || !buttonRef.current) {
      return;
    }
    buttonRef.current.scrollIntoView({ block: 'nearest' });
  }, [isActive]);

  const Icon = type === 'message' ? MessageSquare : MessagesSquare;

  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="option"
      aria-selected={isActive}
      data-active={isActive ? '' : undefined}
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover focus:outline-none',
        isActive && 'bg-surface-hover',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The badge sits beside the title rather than inside it: as one truncating
            line, a long title pushed the badge out of view entirely — and it is the
            only thing saying the match was found inside a message, not in the title. */}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-normal text-text-primary">{title}</span>
          {type === 'message' ? (
            <span className="flex-shrink-0 rounded bg-surface-tertiary px-1.5 py-px text-[10px] font-medium text-text-secondary">
              {localize('com_endpoint_message')}
            </span>
          ) : null}
        </span>
        {snippet ? (
          <span className="mt-0.5 line-clamp-2 border-l-2 border-border-light pl-2 text-xs text-text-secondary">
            {snippet}
          </span>
        ) : null}
      </div>
      {rightLabel ? (
        <span className="flex-shrink-0 text-xs text-text-secondary">{rightLabel}</span>
      ) : null}
    </button>
  );
});

export default Item;
