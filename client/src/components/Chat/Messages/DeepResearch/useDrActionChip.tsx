import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, isDrStartCommand, isDrCancelCommand } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import ActionChip from './ActionChip';

/**
 * The Deep Research command chip decision in ONE place — same shape as
 * [useAskUserChip], and for the same reason. User messages travel two render
 * paths, and `MultiMessage` picks between them on `message.content`: content
 * parts go to ContentRender, everything else to MessageRender. DR command
 * messages are built by `getPreliminaryUserMessage` (server) and
 * `useChatFunctions` (client), and neither attaches `content` — on the live
 * stand NO user message has ever carried it — so every command message takes
 * the text-only path, which is precisely where the chip was not mounted. The
 * chip was mounted on ContentRender alone and had therefore never rendered in
 * a real chat: users saw the raw «Начать исследование» in a plain bubble.
 *
 * Provenance rule, unchanged from ContentRender: the persisted `drKind` decides,
 * and the command TEXT counts only for the optimistic window before the server
 * save lands — and only under a drKind-verified plan/clarify parent. Prose that
 * merely reads like the marker stays prose.
 */
export default function useDrActionChip(msg: TMessage | undefined | null): ReactNode | null {
  const queryClient = useQueryClient();
  if (msg?.isCreatedByUser !== true) {
    return null;
  }
  const text = msg.text ?? '';
  if (msg.drKind === 'start' || msg.drKind === 'cancel') {
    return <ActionChip text={text} />;
  }
  if (!isDrStartCommand(text) && !isDrCancelCommand(text)) {
    return null;
  }
  const cached = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, msg.conversationId]);
  const parent = cached?.find((m) => m.messageId === msg.parentMessageId);
  if (parent?.drKind !== 'plan' && parent?.drKind !== 'clarify') {
    return null;
  }
  return <ActionChip text={text} />;
}
