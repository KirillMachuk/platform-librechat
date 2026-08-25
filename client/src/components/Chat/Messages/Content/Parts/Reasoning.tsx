import { memo, useMemo, useState, useCallback, useEffect, useRef, useId } from 'react';
import { useAtomValue } from 'jotai';
import { ThinkingReasoning } from '~/components/Chat/Cards/ThinkingReasoning';
import { showThinkingAtom } from '~/store/showThinking';
import { useMessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';

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
 * Since cards К4 the block renders through the vendored ThinkingReasoning
 * (aicss thinking-reasoning, §6.17): borderless, sentences reveal while the
 * thoughts stream, and the finished block folds into «Думал N с». The
 * duration is measured here from the first to the last think chunk and
 * parked in ContentParts' timing map (like the expansion flag) so it
 * survives the finalization remount; a reloaded page has no measurement and
 * shows plain «Мысли».
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
    autoExpandReasoning,
    reasoningExpandedInitial,
    onReasoningExpandedChange,
    reasoningDurationMs,
    onReasoningStreamTick,
  } = useMessageContext();
  /* reasoningExpandedInitial seeds the state across the finalization remount
   * (the part key carries messageId, which swaps to the server id when the
   * stream ends) — without it a card the user expanded during streaming
   * collapsed the moment the reply finished. */
  const [isExpanded, setIsExpanded] = useState(
    reasoningExpandedInitial ?? (showThinking || autoExpandReasoning === true),
  );

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

  const handleToggle = useCallback(() => {
    const next = !isExpanded;
    onReasoningExpandedChange?.(next);
    setIsExpanded(next);
  }, [isExpanded, onReasoningExpandedChange]);

  const effectiveIsSubmitting = isLatestMessage ? isSubmitting : false;

  /* One waiting word platform-wide (owner, round 24): while thoughts stream
   * the header carries the same shimmering «Думаю…» the pre-stream label
   * showed. Since К4 the finished header reads «Думал N с» when the duration
   * was measured in this session, plain «Мысли» otherwise. */
  const isStreamingThoughts = (effectiveIsSubmitting ?? false) && isLast;

  useEffect(() => {
    if (isStreamingThoughts && reasoningText) {
      onReasoningStreamTick?.();
    }
  }, [isStreamingThoughts, reasoningText, onReasoningStreamTick]);

  const { doneVerb, doneSuffix } = useMemo(() => {
    if (reasoningDurationMs == null) {
      return { doneVerb: localize('com_ui_thoughts'), doneSuffix: undefined };
    }
    const secs = Math.max(1, Math.round(reasoningDurationMs / 1000));
    const suffix =
      secs < 60
        ? localize('com_ui_thoughts_for_secs', { 0: String(secs) })
        : localize('com_ui_thoughts_for_min', {
            0: String(Math.floor(secs / 60)),
            1: String(secs % 60),
          });
    return { doneVerb: localize('com_ui_thoughts_done_verb'), doneSuffix: suffix };
  }, [reasoningDurationMs, localize]);

  if (!reasoningText) {
    return null;
  }

  return (
    <div className="group/reasoning">
      <ThinkingReasoning
        text={reasoningText}
        streaming={isStreamingThoughts}
        expanded={isExpanded}
        onToggle={handleToggle}
        shimmerLabel={localize('com_ui_thinking_indicator')}
        doneVerb={doneVerb}
        doneSuffix={doneSuffix}
        ariaLabel={localize('com_ui_thoughts')}
        contentId={contentId}
      />
    </div>
  );
});

export default Reasoning;
