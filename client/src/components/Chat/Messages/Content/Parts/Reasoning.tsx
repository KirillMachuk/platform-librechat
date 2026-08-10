import { memo, useMemo, useState, useCallback, useEffect, useRef, useId } from 'react';
import { useAtomValue } from 'jotai';
import { ContentTypes } from 'librechat-data-provider';
import type { MouseEvent, FocusEvent } from 'react';
import { ThinkingContent, ThinkingButton, ThinkingCard, FloatingThinkingBar } from './Thinking';
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
  const { isSubmitting, isLatestMessage, nextType, autoExpandReasoning } = useMessageContext();
  const [isExpanded, setIsExpanded] = useState(showThinking || autoExpandReasoning === true);
  const [isBarVisible, setIsBarVisible] = useState(false);
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

  const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsExpanded((prev) => !prev);
  }, []);

  const handleFocus = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleBlur = useCallback((e: FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsBarVisible(false);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsBarVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!containerRef.current?.contains(document.activeElement)) {
      setIsBarVisible(false);
    }
  }, []);

  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;

  const label = useMemo(
    () =>
      effectiveIsSubmitting && isLast ? localize('com_ui_thinking') : localize('com_ui_thoughts'),
    [effectiveIsSubmitting, localize, isLast],
  );

  if (!reasoningText) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="group/reasoning"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="group/thinking-container">
        <ThinkingCard>
          <ThinkingButton
            isExpanded={isExpanded}
            onClick={handleClick}
            label={label}
            content={reasoningText}
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
              <FloatingThinkingBar
                isVisible={isBarVisible && isExpanded}
                isExpanded={isExpanded}
                onClick={handleClick}
                content={reasoningText}
                contentId={contentId}
              />
            </div>
          </div>
        </ThinkingCard>
      </div>
    </div>
  );
});

export default Reasoning;
