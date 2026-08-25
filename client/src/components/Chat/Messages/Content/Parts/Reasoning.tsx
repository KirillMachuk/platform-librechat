import { memo, useMemo, useState, useCallback, useEffect, useRef, useId } from 'react';
import { useAtomValue } from 'jotai';
import { ContentTypes } from 'librechat-data-provider';
import type { MouseEvent, FocusEvent } from 'react';
import { ThinkingContent, ThinkingButton, ThinkingCard } from './Thinking';
import { useLocalize, useExpandCollapse } from '~/hooks';
import { showThinkingAtom } from '~/store/showThinking';
import { useMessageContext } from '~/Providers';
import { cn } from '~/utils';

type ReasoningProps = {
  reasoning: string;
  isLast: boolean;
};

/**
 * Reasoning Component (MODERN SYSTEM)
 *
 * Used for structured content parts with ContentTypes.THINK type.
 * This handles modern message format where content is an array of typed parts.
 *
 * Pattern: `{ content: [{ type: "think", think: "<think>content</think>" }, ...] }`
 *
 * Used by:
 * - ContentParts.tsx → Part.tsx for structured messages
 * - Agent/Assistant responses (OpenAI Assistants, custom agents)
 * - O-series models (o1, o3) with reasoning capabilities
 * - Modern Claude responses with thinking blocks
 *
 * Key differences from legacy Thinking.tsx:
 * - Works with content parts array instead of plain text
 * - Strips `<think>` tags instead of `:::thinking:::` markers
 * - Each THINK part has its own independent toggle button
 * - Can be interleaved with other content types
 *
 * For legacy text-based messages, see Thinking.tsx component.
 */
const Reasoning = memo(({ reasoning, isLast }: ReasoningProps) => {
  const contentId = useId();
  const localize = useLocalize();
  const showThinking = useAtomValue(showThinkingAtom);
  const {
    isSubmitting,
    isLatestMessage,
    nextType,
    autoExpandReasoning,
    reasoningExpandedInitial,
    onReasoningExpandedChange,
  } = useMessageContext();
  /* reasoningExpandedInitial seeds the state across the finalization remount
   * (the part key carries messageId, which swaps to the server id when the
   * stream ends) — without it a card the user expanded during streaming
   * collapsed the moment the reply finished. */
  const [isExpanded, setIsExpanded] = useState(
    reasoningExpandedInitial ?? (showThinking || autoExpandReasoning === true),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isExpanded);

  /**
   * The message finished with its reply inside the thinking channel (see
   * `autoExpandThinkIdx` in ContentParts): expand once so the reply is visible.
   * The ref makes it once per mount — a manual collapse afterwards sticks.
   */
  const didAutoExpand = useRef(autoExpandReasoning === true);
  useEffect(() => {
    if (autoExpandReasoning === true && !didAutoExpand.current) {
      didAutoExpand.current = true;
      setIsExpanded(true);
    }
  }, [autoExpandReasoning]);

  // Strip <think> tags from the reasoning content (modern format)
  const reasoningText = useMemo(() => {
    return reasoning
      .replace(/^<think>\s*/, '')
      .replace(/\s*<\/think>$/, '')
      .trim();
  }, [reasoning]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const next = !isExpanded;
      onReasoningExpandedChange?.(next);
      setIsExpanded(next);
    },
    [isExpanded, onReasoningExpandedChange],
  );

  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;

  /* One waiting word platform-wide (owner, round 24): while thoughts stream
   * the header carries the same shimmering «Думаю…» the pre-stream label
   * showed — the label reads as one element growing a card around itself —
   * and settles into «Мысли» when the reply completes. */
  const isStreamingThoughts = effectiveIsSubmitting && isLast;
  const label = useMemo(
    () =>
      isStreamingThoughts ? localize('com_ui_thinking_indicator') : localize('com_ui_thoughts'),
    [isStreamingThoughts, localize],
  );

  if (!reasoningText) {
    return null;
  }

  return (
    <div ref={containerRef} className="group/reasoning">
      <div className="group/thinking-container">
        <ThinkingCard expanded={isExpanded}>
          <ThinkingButton
            isExpanded={isExpanded}
            onClick={handleClick}
            label={label}
            shimmer={isStreamingThoughts}
            contentId={contentId}
          />
          <div
            id={contentId}
            role="group"
            aria-label={label}
            aria-hidden={!isExpanded || undefined}
            className={cn(nextType !== ContentTypes.THINK && isExpanded && 'mb-1')}
            style={expandStyle}
          >
            <div className="relative overflow-hidden" ref={expandRef}>
              <ThinkingContent>{reasoningText}</ThinkingContent>
            </div>
          </div>
        </ThinkingCard>
      </div>
    </div>
  );
});

export default Reasoning;
