import React from 'react';
import 'test/matchMedia.mock';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EventSubmission, TMessage } from 'librechat-data-provider';
import type { TFinalResData } from '~/common';
import { AuthContextProvider } from '~/hooks/AuthContext';
import useEventHandlers from '../useEventHandlers';

/**
 * The owner's 14.09 report: Stop pressed while the model was still silent left an
 * EMPTY answer under the question, with the whole action row beneath it. The server
 * now persists nothing for such a stop and its final carries no answer message; the
 * chat has to show exactly that — the question, and no turn under it.
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

const question = message({ messageId: 'u1', isCreatedByUser: true, text: 'Привет' });
const placeholder = message({
  messageId: 'r1',
  parentMessageId: 'u1',
  content: [{ type: 'text', text: '' }],
} as Partial<TMessage>);

const stoppedFinal = (over: Partial<EventSubmission> = {}) => {
  const data = {
    final: true,
    aborted: true,
    earlyAbort: false,
    requestMessage: question,
    responseMessage: null,
    conversation: { conversationId: 'c1', endpoint: 'agents' },
  } as unknown as TFinalResData;
  const submission = {
    messages: [],
    conversation: { conversationId: 'c1', endpoint: 'agents' },
    initialResponse: placeholder,
    userMessage: question,
    isRegenerate: false,
    ...over,
  } as unknown as EventSubmission;
  return { data, submission };
};

describe('finalHandler when a Stop produced no answer', () => {
  it('keeps the question and drops the placeholder — no empty turn', () => {
    const { result, messages, params } = setup([question, placeholder]);
    const { data, submission } = stoppedFinal();
    act(() => {
      result.current.finalHandler(data, submission);
    });
    expect(messages.map((m) => m.messageId)).toEqual(['u1']);
    expect(params.setIsSubmitting).toHaveBeenCalledWith(false);
  });

  it('on a regenerate, the tree goes back to what it was before the placeholder', () => {
    const earlier = message({ messageId: 'r0', parentMessageId: 'u1', text: 'Старый ответ' });
    const { result, messages } = setup([question, earlier, placeholder]);
    const { data, submission } = stoppedFinal({ isRegenerate: true });
    act(() => {
      result.current.finalHandler(data, submission);
    });
    expect(messages.map((m) => m.messageId)).toEqual(['u1', 'r0']);
  });
});
