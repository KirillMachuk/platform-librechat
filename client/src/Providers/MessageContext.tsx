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
};

export const MessageContext = createContext<MessageContext>({} as MessageContext);
export const useMessageContext = () => useContext(MessageContext);
