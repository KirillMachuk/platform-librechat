import { isDrStartCommand, isDrCancelCommand } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useOptionalMessagesOperations } from '~/Providers/MessagesViewContext';
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
 * merely reads like the marker stays prose. `drKind` also picks the LABEL: the
 * text decides only in the optimistic window, where it is the very thing that
 * admitted the chip, so the caption can never assert a state the data denies.
 *
 * The parent comes from `getMessages()` — the same list the surrounding view
 * renders — rather than a hand-built react-query key. That is what makes the
 * hook work unchanged on the share page (ShareMessagesProvider supplies the
 * shared messages) and outside any provider (the stub returns undefined).
 */
export default function useDrActionChip(msg: TMessage | undefined | null): ReactNode | null {
  const { getMessages } = useOptionalMessagesOperations();
  if (msg?.isCreatedByUser !== true) {
    return null;
  }
  const text = msg.text ?? '';
  if (msg.drKind === 'start' || msg.drKind === 'cancel') {
    return <ActionChip cancelled={msg.drKind === 'cancel'} />;
  }
  if (!isDrStartCommand(text) && !isDrCancelCommand(text)) {
    return null;
  }
  const parent = getMessages()?.find((m) => m.messageId === msg.parentMessageId);
  if (parent?.drKind !== 'plan' && parent?.drKind !== 'clarify') {
    return null;
  }
  return <ActionChip cancelled={isDrCancelCommand(text)} />;
}
