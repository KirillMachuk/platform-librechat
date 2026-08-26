import {
  isAskSkipMessage,
  isAskAnswersMessage,
  contentHasAskUserCall,
} from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useOptionalMessagesOperations } from '~/Providers/MessagesViewContext';
import AnswersChip from './AnswersChip';

/**
 * The ask-user answers/skip chip decision in ONE place (interactive cards
 * К3). User messages travel two render paths — with `content[]` through
 * ContentRender, text-only through MessageRender — and the chip must behave
 * identically on both (the review caught it mounted on only one, where the
 * mock/custom path never goes: a dead chip with a green-for-the-wrong-reason
 * e2e). Renders ONLY under a parent that actually carries an `ask_user` tool
 * call — the drKind provenance lesson: prose that merely looks like the
 * marker must not change its rendering.
 *
 * The parent comes from `getMessages()` — the same list the surrounding view
 * renders — rather than a hand-built react-query key, so the hook works
 * unchanged on the share page, where `ShareMessagesProvider` supplies the
 * shared messages and no chat cache exists.
 */
export default function useAskUserChip(msg: TMessage | undefined | null): ReactNode | null {
  const { getMessages } = useOptionalMessagesOperations();
  if (msg?.isCreatedByUser !== true) {
    return null;
  }
  const text = msg.text ?? '';
  if (!isAskAnswersMessage(text) && !isAskSkipMessage(text)) {
    return null;
  }
  const parent = getMessages()?.find((m) => m.messageId === msg.parentMessageId);
  if (!contentHasAskUserCall(parent?.content)) {
    return null;
  }
  return <AnswersChip text={text} />;
}
