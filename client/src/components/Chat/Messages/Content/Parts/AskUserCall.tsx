import { memo, useContext, useId, useMemo, useRef, useState } from 'react';
import { useToastContext } from '@librechat/client';
import {
  ASK_SKIP_MARKER,
  buildAskAnswersMessage,
  isAskAnswersMessage,
  isAskSkipMessage,
  parseAskUserArgs,
} from 'librechat-data-provider';
import type { AskUserQuestion } from 'librechat-data-provider';
import type { ApprovalCardStrings } from '~/components/Chat/Cards/ApprovalCard';
import { useOptionalMessagesOperations } from '~/Providers/MessagesViewContext';
import { MessageCircleQuestion, ChevronDown } from '~/components/icons';
import { ApprovalCard } from '~/components/Chat/Cards/ApprovalCard';
import useExpandCollapse from '~/hooks/Messages/useExpandCollapse';
import { ChatContext, useMessageContext } from '~/Providers';
import { useSubmitMessage } from '~/hooks/Messages';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * Renders the `ask_user` tool call as the interactive questions card
 * (interactive cards К3/r25). The tool executes nothing server-side — THIS is
 * the tool's real body: «Продолжить» submits ONE ordinary user message with
 * all answers (buildAskAnswersMessage), «Пропустить» submits the skip
 * marker; the model reads either as plain text (deepResearchRun's
 * message-level pattern — no run pause, survives refresh).
 *
 * r25 (owner): the options are selectable the moment the card appears — even
 * while the model's closing sentence still streams — and only the commit
 * controls wait for the turn to end (actionsArmed). Selections survive the
 * finalization remount through ContentParts' askAnswers map. An answered or
 * historical card folds into a one-line summary (the answers chip below
 * carries the content), reopening onto the static card.
 *
 * Split in two on purpose (review К4): the share page renders Parts OUTSIDE
 * ChatContext, and the chat hooks THROW there — the outer component checks
 * the context and mounts the hook-bearing interactive body only inside a
 * live chat; everywhere else the folded summary renders.
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

/**
 * What the user actually answered, for a card that is no longer live.
 *
 * Two sources, in this order: the answers summary MESSAGE the card itself
 * submitted (durable — survives a reload and works on the share page, and it
 * is what was really sent), then the in-session draft map. Without this the
 * folded card renders a fresh, blank ApprovalCard: the chosen option loses
 * its mark, the «Другое…» text disappears, and a screen reader announces
 * every option as not-checked — which is actively wrong (r25 acceptance).
 */
function useAnsweredValues(questions: AskUserQuestion[]): Record<string, string> | undefined {
  const { messageId, askAnswersInitial } = useMessageContext();
  const { getMessages } = useOptionalMessagesOperations();
  const messages = getMessages();
  return useMemo(() => {
    const reply = messages?.find(
      (m) =>
        m.parentMessageId === messageId &&
        m.isCreatedByUser === true &&
        (isAskAnswersMessage(m.text ?? '') || isAskSkipMessage(m.text ?? '')),
    );
    /* Skipped: the user walked away from whatever was half-picked, so the card
     * must show nothing. Falling through to the draft made it claim an answer
     * the user never sent, right above a chip reading «Вопросы пропущены»
     * (r25c review). */
    if (reply != null && isAskSkipMessage(reply.text ?? '')) {
      return undefined;
    }
    if (reply != null) {
      /* Matched by the question's OWN text, not by line order: the summary
       * separator « — » also occurs inside model-written prompts («Формат
       * отчёта — краткий или подробный?»), and a positional parse then put
       * half the question into the answer, or slid every answer up a row when
       * one line failed to parse. The prompts here and the ones in the summary
       * both come from parseAskUserArgs, so they are equal byte for byte. */
      const lines = (reply.text ?? '').split('\n').slice(1);
      const restored: Record<string, string> = {};
      for (const q of questions) {
        const marker = `) ${q.prompt} — `;
        const line = lines.find((l) => l.includes(marker));
        if (line == null) {
          continue;
        }
        const answer = line.slice(line.indexOf(marker) + marker.length).trim();
        if (answer) {
          restored[q.id] = answer;
        }
      }
      if (Object.keys(restored).length > 0) {
        return restored;
      }
    }
    return askAnswersInitial;
  }, [messages, messageId, questions, askAnswersInitial]);
}

function StaticCard({
  questions,
  answers,
}: {
  questions: AskUserQuestion[];
  answers?: Record<string, string>;
}) {
  const localize = useLocalize();
  const strings = useCardStrings();
  return (
    <div className="w-full pt-2">
      <ApprovalCard
        variant="questions"
        strings={strings}
        title={localize('com_ui_cards_questions_title')}
        approveLabel={localize('com_ui_cards_continue')}
        questions={questions}
        initialAnswers={answers}
        showActions={false}
      />
    </div>
  );
}

/** The folded state of an answered/historical questions card: one dim line
 *  in the «Думал N с» family; the content lives in the answers chip below. */
function CollapsedQuestions({ questions }: { questions: AskUserQuestion[] }) {
  const localize = useLocalize();
  const answers = useAnsweredValues(questions);
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(open);
  const label = localize('com_ui_cards_questions_title');
  return (
    <div className="my-2 w-full" data-testid="ask-user-collapsed">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center gap-1.5 text-[length:calc(var(--markdown-font-size)*13/16)] font-medium leading-[18px] text-text-tertiary transition-colors [@media(hover:hover)]:hover:text-text-primary"
        onClick={() => setOpen((prev) => !prev)}
      >
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <div
        id={contentId}
        role="group"
        aria-label={label}
        aria-hidden={!open || undefined}
        style={expandStyle}
      >
        {/* `overflow-hidden` is what makes the 0fr row actually clip, and it
         * clips sideways too — the card's edge is a box-shadow ring painted
         * OUTSIDE its border box, so the hairline was cut off at the left and
         * right and only survived at the top, where an 8px margin gave it room
         * (owner r28: «по сторонам border… скрывается»). The negative margin
         * moves the clip boundary outward and the equal padding puts the card
         * back where it was, so nothing shifts and the ring has somewhere to
         * live. */}
        <div className="relative -mx-1 overflow-hidden px-1" ref={expandRef}>
          <StaticCard questions={questions} answers={answers} />
        </div>
      </div>
    </div>
  );
}

function InteractiveCard({ questions }: { questions: AskUserQuestion[] }) {
  const localize = useLocalize();
  const strings = useCardStrings();
  const { showToast } = useToastContext();
  const { submitMessage } = useSubmitMessage();
  const { isSubmitting, isLatestMessage, askAnswersInitial, onAskAnswersChange } =
    useMessageContext();
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

  const present = isLatestMessage === true && !acted;
  const armed = present && isSubmitting !== true;

  if (!present) {
    return <CollapsedQuestions questions={questions} />;
  }

  return (
    <div className="my-2 w-full">
      <ApprovalCard
        variant="questions"
        strings={strings}
        title={localize('com_ui_cards_questions_title')}
        approveLabel={localize('com_ui_cards_continue')}
        secondaryLabel={localize('com_ui_cards_skip')}
        questions={questions}
        showActions={true}
        actionsArmed={armed}
        initialAnswers={askAnswersInitial}
        onAnswersChange={onAskAnswersChange}
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
    return <CollapsedQuestions questions={questions} />;
  }
  return <InteractiveCard questions={questions} />;
});

AskUserCall.displayName = 'AskUserCall';

export default AskUserCall;
