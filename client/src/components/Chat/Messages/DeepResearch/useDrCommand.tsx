import { isDrStartCommand, isDrCancelCommand } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { useOptionalMessagesOperations } from '~/Providers/MessagesViewContext';

/**
 * The Deep Research command-message decision in ONE place, for every render
 * path (ContentRender, MessageRender, the share page).
 *
 * r25 (owner): command rows are HIDDEN from the transcript instead of drawn
 * as chips. «Начать исследование» duplicated what the progress and report
 * cards already say, and «Отменить исследование» now lands as the «Отменено»
 * badge on the plan card itself — the outcome lives on the artifact it
 * belongs to. The messages themselves stay untouched in the data: a button
 * click is a real user turn (it survives refresh, the model reads it as
 * text, history stays honest) — only its visual row goes.
 *
 * Provenance rule, unchanged: the persisted `drKind` decides, and the command
 * TEXT counts only for the optimistic window before the server save lands —
 * and only under a drKind-verified plan/clarify parent. Prose that merely
 * reads like the marker stays prose. The parent comes from `getMessages()` —
 * the same list the surrounding view renders — which is what makes the hook
 * work unchanged on the share page and outside any provider.
 */
export default function useDrCommand(msg: TMessage | undefined | null): 'start' | 'cancel' | null {
  const { getMessages } = useOptionalMessagesOperations();
  if (msg?.isCreatedByUser !== true) {
    return null;
  }
  const text = msg.text ?? '';
  if (msg.drKind === 'start' || msg.drKind === 'cancel') {
    return msg.drKind;
  }
  if (!isDrStartCommand(text) && !isDrCancelCommand(text)) {
    return null;
  }
  const parent = getMessages()?.find((m) => m.messageId === msg.parentMessageId);
  if (parent?.drKind !== 'plan' && parent?.drKind !== 'clarify') {
    return null;
  }
  return isDrCancelCommand(text) ? 'cancel' : 'start';
}
