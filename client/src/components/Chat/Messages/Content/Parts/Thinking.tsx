import { useState, useMemo, memo, useCallback, useRef, useId, type MouseEvent } from 'react';
import { useAtomValue } from 'jotai';
import { Clipboard, CheckMark } from '@librechat/client';
import type { FocusEvent, FC } from 'react';
import { Lightbulb, ChevronDown } from '~/components/icons';
import { useLocalize, useExpandCollapse } from '~/hooks';
import { showThinkingAtom } from '~/store/showThinking';
import { cn } from '~/utils';

/**
 * ThinkingContent - Displays the actual thinking/reasoning content
 * Used by both legacy text-based messages and modern content parts
 */
export const ThinkingContent: FC<{
  children: React.ReactNode;
}> = memo(({ children }) => {
  /* The BODY of the book's .think card: t3 text one step below the
   * conversation (--thinking-font-size derives from the message size, so
   * the two can never diverge), behind a dashed hairline the header sits
   * above. The card itself — border, radius 12, panel fill — is drawn by
   * ThinkingCard so header and body live inside ONE box, as the book draws
   * it. */
  return (
    <div className="relative border-t border-dashed border-border-light px-3 pb-3 pt-[9px] text-text-tertiary">
      <p className="whitespace-pre-wrap text-[length:var(--thinking-font-size)] leading-[1.55]">
        {children}
      </p>
    </div>
  );
});

/** The book's «Мысли» card (§6.13, `.think`): ONE hairline box, radius 12,
 *  panel fill, holding both the toggle header and the body. */
export const ThinkingCard: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-2.5 overflow-hidden rounded-xl border border-border-light bg-surface-secondary">
    {children}
  </div>
);

/**
 * ThinkingButton - Toggle button for expanding/collapsing thinking content
 * Shows lightbulb icon by default, chevron on hover
 * Shared between legacy Thinking component and modern ContentParts
 */
export const ThinkingButton = memo(
  ({
    isExpanded,
    onClick,
    label,
    content,
    contentId,
    showCopyButton = true,
  }: {
    isExpanded: boolean;
    onClick: (e: MouseEvent<HTMLButtonElement>) => void;
    label: string;
    content?: string;
    contentId: string;
    showCopyButton?: boolean;
  }) => {
    const localize = useLocalize();

    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (content) {
          navigator.clipboard.writeText(content);
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
      },
      [content],
    );

    return (
      <div className="group/thinking flex w-full items-center justify-between gap-2">
        {/* The book's header row (§6.13 `.think>button`): 13-scale t2 text,
         * the lightbulb 16px in the ACCENT — one of the few places the
         * owner's petrol list keeps it — and the chevron waiting at the
         * right edge, turning over when the card opens. The old
         * hover-swaps-icon trick is gone: the book draws both at once. */}
        <button
          type="button"
          onClick={onClick}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="group/button flex flex-1 items-center gap-2 px-3 py-[9px] text-left text-[length:var(--thinking-font-size)] leading-[18px] text-text-secondary"
        >
          <Lightbulb className="icon-sm shrink-0 text-text-accent" aria-hidden="true" />
          <span className="flex-1 truncate">{label}</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform duration-150',
              isExpanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
        {content && showCopyButton && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={
              isCopied
                ? localize('com_ui_copied_to_clipboard')
                : localize('com_ui_copy_thoughts_to_clipboard')
            }
            className={cn(
              'rounded-lg p-1.5 text-text-secondary-alt',
              isExpanded
                ? 'opacity-0 group-focus-within/thinking-container:opacity-100 group-hover/thinking-container:opacity-100'
                : 'opacity-0',
              'hover:bg-surface-hover hover:text-text-primary',
              'focus-visible:opacity-100 focus-visible:outline-none',
            )}
          >
            <span className="sr-only">
              {isCopied
                ? localize('com_ui_copied_to_clipboard')
                : localize('com_ui_copy_thoughts_to_clipboard')}
            </span>
            {isCopied ? (
              <CheckMark className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Clipboard size="19" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    );
  },
);

/**
 * Thinking Component (LEGACY SYSTEM)
 *
 * Used for simple text-based messages with `:::thinking:::` markers.
 * This handles the old message format where text contains embedded thinking blocks.
 *
 * Pattern: `:::thinking\n{content}\n:::\n{response}`
 *
 * Used by:
 * - MessageContent.tsx for plain text messages
 * - Legacy message format compatibility
 * - User messages when manually adding thinking content
 *
 * For modern structured content (agents/assistants), see Reasoning.tsx component.
 */
const Thinking: React.ElementType = memo(({ children }: { children: React.ReactNode }) => {
  const localize = useLocalize();
  const showThinking = useAtomValue(showThinkingAtom);
  const [isExpanded, setIsExpanded] = useState(showThinking);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsExpanded((prev) => !prev);
  }, []);

  const label = useMemo(() => localize('com_ui_thoughts'), [localize]);

  // Extract text content for copy functionality
  const textContent = useMemo(() => {
    if (typeof children === 'string') {
      return children;
    }
    return '';
  }, [children]);

  if (children == null) {
    return null;
  }

  return (
    <div ref={containerRef} className="group/thinking-container">
      <ThinkingCard>
        <ThinkingButton
          isExpanded={isExpanded}
          onClick={handleClick}
          label={label}
          content={textContent}
          contentId={contentId}
        />
        <div
          id={contentId}
          role="group"
          aria-label={label}
          aria-hidden={!isExpanded || undefined}
          style={expandStyle}
        >
          <div className="relative overflow-hidden" ref={expandRef}>
            <ThinkingContent>{children}</ThinkingContent>
          </div>
        </div>
      </ThinkingCard>
    </div>
  );
});

ThinkingButton.displayName = 'ThinkingButton';
ThinkingContent.displayName = 'ThinkingContent';
Thinking.displayName = 'Thinking';

export default Thinking;
