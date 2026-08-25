import { createContext, useContext } from 'react';

type MessageContext = {
  messageId: string;
  nextType?: string;
  partIndex?: number;
  isExpanded: boolean;
  conversationId?: string | null;
  /** Submission state for cursor display - only true for latest message when submitting */
  isSubmitting?: boolean;
  /** Whether this is the latest message in the conversation */
  isLatestMessage?: boolean;
  /**
   * Set on the final THINK part of a completed message that has no visible text
   * answer: some models (seen in prod with deepseek v3.1) put the whole reply in
   * the reasoning channel, which otherwise renders as collapsed "Thoughts" and an
   * apparently empty message. The Reasoning block expands itself once in response.
   */
  autoExpandReasoning?: boolean;
  /**
   * Reasoning-card expansion persisted OUTSIDE the part component. The part
   * key carries messageId, which changes at stream finalization (intermediate
   * id -> server id) and remounts the whole part subtree — a card the user
   * expanded during streaming collapsed the moment the reply finished. The
   * map lives in ContentParts (like toolGroupExpansionRef) keyed by part
   * index, which is stable across that remount.
   */
  reasoningExpandedInitial?: boolean;
  onReasoningExpandedChange?: (expanded: boolean) => void;
  /**
   * Thinking duration for the finished «Думал N с» header (cards К4),
   * measured first→last think chunk of THIS session. Lives in ContentParts'
   * timing map next to the expansion flag — same survival rules across the
   * finalization remount. Absent after a page reload (the message carries no
   * timing) — the header degrades to plain «Мысли».
   */
  reasoningDurationMs?: number;
  /** Called by the Reasoning part on every think chunk while streaming. */
  onReasoningStreamTick?: () => void;
};

export const MessageContext = createContext<MessageContext>({} as MessageContext);
export const useMessageContext = () => useContext(MessageContext);
