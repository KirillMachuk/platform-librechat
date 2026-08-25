import { useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  isAskSkipMessage,
  isAskAnswersMessage,
  contentHasAskUserCall,
} from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ReactNode } from 'react';
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
 */
export default function useAskUserChip(msg: TMessage | undefined | null): ReactNode | null {
  const queryClient = useQueryClient();
  if (msg?.isCreatedByUser !== true) {
    return null;
  }
  const text = msg.text ?? '';
  if (!isAskAnswersMessage(text) && !isAskSkipMessage(text)) {
    return null;
  }
  const cached = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, msg.conversationId]);
  const parent = cached?.find((m) => m.messageId === msg.parentMessageId);
  if (!contentHasAskUserCall(parent?.content)) {
    return null;
  }
  return <AnswersChip text={text} />;
}
