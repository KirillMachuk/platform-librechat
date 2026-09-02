import React from 'react';
import 'test/matchMedia.mock';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import type { EventSubmission, TFinalResData } from '~/common';
import { AuthContextProvider } from '~/hooks/AuthContext';
import { planArrivedLive } from '~/store/deepResearch';
import useEventHandlers from '../useEventHandlers';

/**
 * The plan card's self-start («Запускать исследование сразу», r30) fires only on a plan
 * whose FINAL this tab processed. That mark is set here, in `finalHandler`, and nowhere
 * else — so this is the one seam that makes the feature exist at all: drop the line and
 * every plan looks like history, the setting does nothing, and no other test notices.
 */

const PLAN = '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить';

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

function setup() {
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
  const messages: TMessage[] = [];
  /* What the mark must precede: the commit that mounts the card. */
  const markedWhenCommitted: boolean[] = [];
  const params = {
    setMessages: jest.fn((next: TMessage[]) => {
      markedWhenCommitted.push(planArrivedLive('r1'));
      messages.splice(0, messages.length, ...next);
    }),
    getMessages: jest.fn(() => messages),
    setCompleted: jest.fn(),
    setIsSubmitting: jest.fn(),
    setShowStopButton: jest.fn(),
  };
  const { result } = renderHook(() => useEventHandlers(params), { wrapper });
  return { result, messages, markedWhenCommitted };
}

const finalFor = (responseOver: Partial<TMessage>) => {
  const requestMessage = message({ messageId: 'u1', isCreatedByUser: true, text: 'Собери план' });
  const responseMessage = message({
    messageId: 'r1',
    parentMessageId: 'u1',
    text: PLAN,
    content: [{ type: 'text', text: PLAN }],
    ...responseOver,
  } as Partial<TMessage>);
  const initialResponse = message({
    messageId: 'r1',
    parentMessageId: 'u1',
    content: [{ type: 'text', text: '' }],
  } as Partial<TMessage>);
  const data = {
    final: true,
    requestMessage,
    responseMessage,
    conversation: { conversationId: 'c1', endpoint: 'agents' },
  } as unknown as TFinalResData;
  const submission = {
    messages: [],
    conversation: { conversationId: 'c1', endpoint: 'agents' },
    initialResponse,
    userMessage: requestMessage,
    isRegenerate: false,
  } as unknown as EventSubmission;
  return { data, submission, requestMessage, initialResponse };
};

describe('finalHandler and plans that arrive live (r30)', () => {
  it('marks the plan as just arrived, before the messages that mount its card are committed', () => {
    const { result, messages, markedWhenCommitted } = setup();
    const { data, submission, requestMessage, initialResponse } = finalFor({ drKind: 'plan' });
    messages.push(requestMessage, initialResponse);
    expect(planArrivedLive('r1')).toBe(false);
    act(() => {
      result.current.finalHandler(data, submission);
    });
    expect(planArrivedLive('r1')).toBe(true);
    /* The card decides on its first effect after this commit; a mark set later would
     * miss it and the plan would wait like history. */
    expect(markedWhenCommitted).toEqual([true]);
  });

  it('marks nothing for an ordinary answer or a finished report', () => {
    for (const drKind of [undefined, 'report'] as const) {
      const { result, messages } = setup();
      const { data, submission, requestMessage, initialResponse } = finalFor({
        messageId: `r-${drKind ?? 'plain'}`,
        drKind,
      } as Partial<TMessage>);
      messages.push(requestMessage, initialResponse);
      act(() => {
        result.current.finalHandler(data, submission);
      });
      expect(planArrivedLive(`r-${drKind ?? 'plain'}`)).toBe(false);
    }
  });
});
