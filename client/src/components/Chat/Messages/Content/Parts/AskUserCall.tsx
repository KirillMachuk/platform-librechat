import { memo, useContext, useMemo, useRef, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { ASK_SKIP_MARKER, buildAskAnswersMessage, parseAskUserArgs } from 'librechat-data-provider';
import type { AskUserQuestion } from 'librechat-data-provider';
import type { ApprovalCardStrings } from '~/components/Chat/Cards/ApprovalCard';
import { ApprovalCard } from '~/components/Chat/Cards/ApprovalCard';
import { ChatContext, useMessageContext } from '~/Providers';
import { useSubmitMessage } from '~/hooks/Messages';
import { useLocalize } from '~/hooks';

/**
 * Renders the `ask_user` tool call as the interactive questions card
 * (interactive cards К3). The tool executes nothing server-side — THIS is
 * the tool's real body: «Продолжить» submits ONE ordinary user message with
 * all answers (buildAskAnswersMessage), «Пропустить» submits the skip
 * marker; the model reads either as plain text (deepResearchRun's
 * message-level pattern — no run pause, survives refresh).
 *
 * Split in two on purpose (review К4): the share page renders Parts OUTSIDE
 * ChatContext, and the chat hooks THROW there — the outer component checks
 * the context and mounts the hook-bearing interactive body only inside a
 * live chat; everywhere else the card renders statically.
 */

function useCardStrings(): ApprovalCardStrings {
  const localize = useLocalize();
  return useMemo(
    () => ({
      otherPlaceholder: localize('com_ui_cards_other_placeholder'),
      moreLabel: (n) => localize('com_ui_cards_more', { 0: String(n) }),
      lessLabel: localize('com_ui_cards_less'),
      autoApproveBefore: localize('com_ui_cards_autostart_before'),
      autoApproveAfter: localize('com_ui_cards_autostart_after'),
      autoApproveCancelTip: localize('com_ui_cards_cancel_tip'),
      prevQuestion: localize('com_ui_cards_prev_question'),
      nextQuestion: localize('com_ui_cards_next_question'),
      cancelAutoApprove: localize('com_ui_cards_cancel_autostart'),
      questionOf: (c, t) => localize('com_ui_cards_question_of', { 0: String(c), 1: String(t) }),
      customAnswerFor: (prompt) => localize('com_ui_cards_custom_answer_for', { 0: prompt }),
    }),
    [localize],
  );
}

function StaticCard({ questions }: { questions: AskUserQuestion[] }) {
  const localize = useLocalize();
  const strings = useCardStrings();
  return (
    <div className="my-2 w-full">
      <ApprovalCard
        variant="questions"
        strings={strings}
        title={localize('com_ui_cards_questions_title')}
        approveLabel={localize('com_ui_cards_continue')}
        questions={questions}
        showActions={false}
      />
    </div>
  );
}

function InteractiveCard({ questions }: { questions: AskUserQuestion[] }) {
  const localize = useLocalize();
  const strings = useCardStrings();
  const { showToast } = useToastContext();
  const { submitMessage } = useSubmitMessage();
  const { isSubmitting, isLatestMessage } = useMessageContext();
  const [acted, setActed] = useState(false);
  const actedRef = useRef(false);

  const send = (text: string): void => {
    if (actedRef.current) {
      return;
    }
    if (submitMessage({ text }) === false) {
      showToast({ message: localize('com_ui_send_while_submitting'), status: 'warning' });
      return;
    }
    actedRef.current = true;
    setActed(true);
  };

  const interactive = isLatestMessage === true && isSubmitting !== true && !acted;

  return (
    <div className="my-2 w-full">
      <ApprovalCard
        variant="questions"
        strings={strings}
        title={localize('com_ui_cards_questions_title')}
        approveLabel={localize('com_ui_cards_continue')}
        secondaryLabel={localize('com_ui_cards_skip')}
        questions={questions}
        showActions={interactive}
        onApprove={(payload) => {
          if (payload?.answers == null) {
            return;
          }
          send(buildAskAnswersMessage(questions, payload.answers));
        }}
        onSecondary={() => send(ASK_SKIP_MARKER)}
      />
    </div>
  );
}

const AskUserCall = memo(({ args }: { args: unknown }) => {
  const chat = useContext(ChatContext);
  const questions = useMemo(() => parseAskUserArgs(args), [args]);

  if (questions == null) {
    /* Args still streaming or malformed — nothing to show yet. The server
     * handler already told the model when the shape was wrong. */
    return null;
  }

  if (chat == null) {
    return <StaticCard questions={questions} />;
  }
  return <InteractiveCard questions={questions} />;
});

AskUserCall.displayName = 'AskUserCall';

export default AskUserCall;
