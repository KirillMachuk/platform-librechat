import React from 'react';
import 'test/matchMedia.mock';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EventSubmission, TMessage } from 'librechat-data-provider';
import type { TFinalResData } from '~/common';
import useEventHandlers, { withMidRunSteers } from '../useEventHandlers';
import { buildSubmissionFromResumeState } from '../useResumeOnLoad';
import { AuthContextProvider } from '~/hooks/AuthContext';

/**
 * Mid-run steering: the clarifications typed during a research run are
 * persisted by the steer route and sit between the request and the answer.
 * The final assembles the feed from the submission's snapshot taken BEFORE
 * the turn — so without the server's `steerMessages` they vanished at
 * finalization (and reappeared only after a reload).
 */

const message = (over: Partial<TMessage>): TMessage =>
  ({
    messageId: 'm',
    conversationId: 'c1',
    parentMessageId: null,
    text: '',
    isCreatedByUser: false,
    error: false,
    unfinished: false,
    ...over,
  }) as unknown as TMessage;

const plan = message({ messageId: 'plan1', drKind: 'plan', text: 'план' });
const start = message({
  messageId: 'um1',
  parentMessageId: 'plan1',
  isCreatedByUser: true,
  drKind: 'start',
  text: 'Начать исследование',
});
const steer1 = message({
  messageId: 's1',
  parentMessageId: 'um1',
  isCreatedByUser: true,
  drKind: 'steer',
  text: 'не Минск',
});
const steer2 = message({
  messageId: 's2',
  parentMessageId: 's1',
  isCreatedByUser: true,
  drKind: 'steer',
  text: 'только 2026',
});
const report = message({ messageId: 'r1', parentMessageId: 's2', drKind: 'report', text: 'Отчёт' });

describe('withMidRunSteers', () => {
  it('slots the clarifications between the request and the answer', () => {
    expect(
      withMidRunSteers([plan], [steer1, steer2], [start, report]).map((m) => m.messageId),
    ).toEqual(['plan1', 'um1', 's1', 's2', 'r1']);
  });

  it('after a reload the snapshot still holds the request and the earlier clarifications — no id doubles (review of part B, К1)', () => {
    /* messagesBeforeTurn with the LAST clarification as the turn's user
     * message keeps `um1` and `s1`; the final re-sends all three. */
    const stale = { ...steer1, text: 'stale copy' };
    const out = withMidRunSteers([plan, start, stale], [steer1, steer2], [start, report]);
    expect(out.map((m) => m.messageId)).toEqual(['plan1', 'um1', 's1', 's2', 'r1']);
    expect(out.find((m) => m.messageId === 's1')?.text).toBe('не Минск');
  });

  it('is the plain concatenation when nothing was steered', () => {
    expect(withMidRunSteers([plan], undefined, [start, report]).map((m) => m.messageId)).toEqual([
      'plan1',
      'um1',
      'r1',
    ]);
  });
});

function setup(initial: TMessage[]) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <MemoryRouter initialEntries={['/c/c1']}>
          <AuthContextProvider authConfig={{ loginRedirect: '', test: true }}>
            {children}
          </AuthContextProvider>
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>
  );
  const messages: TMessage[] = [...initial];
  const params = {
    setMessages: jest.fn((next: TMessage[]) => {
      messages.splice(0, messages.length, ...next);
    }),
    getMessages: jest.fn(() => messages),
    setCompleted: jest.fn(),
    setIsSubmitting: jest.fn(),
    setShowStopButton: jest.fn(),
  };
  const { result } = renderHook(() => useEventHandlers(params), { wrapper });
  return { result, messages, params };
}

describe('finalHandler with mid-run clarifications', () => {
  it('keeps the clarifications in the feed, between the command and the report', () => {
    const placeholder = message({ messageId: 'r1', parentMessageId: 's2', content: [] });
    const { result, messages } = setup([plan, start, steer1, steer2, placeholder]);
    const data = {
      final: true,
      requestMessage: start,
      responseMessage: report,
      steerMessages: [steer1, steer2],
      conversation: { conversationId: 'c1', endpoint: 'agents' },
    } as unknown as TFinalResData;
    const submission = {
      /* The snapshot BEFORE the turn: no clarifications in it. */
      messages: [plan],
      conversation: { conversationId: 'c1', endpoint: 'agents' },
      initialResponse: placeholder,
      userMessage: start,
      isRegenerate: false,
    } as unknown as EventSubmission;

    act(() => {
      result.current.finalHandler(data, submission);
    });

    expect(messages.map((m) => m.messageId)).toEqual(['plan1', 'um1', 's1', 's2', 'r1']);
    expect(messages.find((m) => m.messageId === 'r1')?.parentMessageId).toBe('s2');
  });

  it('after a RELOAD mid-run the feed still has one «Начать», one of each clarification, one report (review of part B, К1)', () => {
    /* What a reloaded tab really holds. The steer route made the LAST
     * clarification the job's «user message of this turn», so the snapshot is
     * cut around IT: the original command and the earlier clarification stay
     * in `submission.messages` — and the final re-sends both. A duplicate id
     * here is the ghost «2 / 2» switcher `messagesBeforeTurn` was written
     * against. The snapshot comes from the real builder, not from a guess. */
    const fromDatabase = [plan, start, steer1, steer2];
    const submission = buildSubmissionFromResumeState(
      {
        userMessage: {
          messageId: 's2',
          parentMessageId: 's1',
          conversationId: 'c1',
          text: 'только 2026',
        },
        responseMessageId: 'r1',
        aggregatedContent: [],
      } as never,
      'c1',
      fromDatabase,
      'c1',
    ) as unknown as EventSubmission;
    expect(submission.messages.map((m) => m.messageId)).toEqual(['plan1', 'um1', 's1']);
    expect(submission.initialResponse.parentMessageId).toBe('s2');

    const { result, messages } = setup(fromDatabase);
    const data = {
      final: true,
      requestMessage: start,
      responseMessage: report,
      steerMessages: [steer1, steer2],
      conversation: { conversationId: 'c1', endpoint: 'agents' },
    } as unknown as TFinalResData;

    act(() => {
      result.current.finalHandler(data, submission);
    });

    const ids = messages.map((m) => m.messageId);
    expect(ids).toEqual(['plan1', 'um1', 's1', 's2', 'r1']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
