import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import useTextarea from '../useTextarea';

/**
 * Mid-run steering: Enter is swallowed while a response is generated — except
 * when the composer is a channel to a running research (`canSteer`), where it
 * must reach the Send button like any other submit (review of part B, В5).
 */

const mockChat = { isSubmitting: true };

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({
    index: 0,
    conversation: { conversationId: 'c1', endpoint: 'agents' },
    isSubmitting: mockChat.isSubmitting,
    filesLoading: false,
    setFilesLoading: jest.fn(),
  }),
}));
jest.mock('~/Providers/AssistantsMapContext', () => ({ useAssistantsMapContext: () => ({}) }));
jest.mock('~/Providers/AgentsMapContext', () => ({ useAgentsMapContext: () => ({}) }));
jest.mock('~/hooks/Messages/useLatestMessage', () => ({ useLatestMessage: () => null }));
jest.mock('~/hooks/Files/useFileHandling', () => ({
  __esModule: true,
  default: () => ({ handleFiles: jest.fn() }),
}));
jest.mock('~/data-provider', () => ({ useInteractionHealthCheck: () => jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

const pressEnter = (canSteer: boolean) => {
  const click = jest.fn();
  const textarea = document.createElement('textarea');
  const { result } = renderHook(
    () =>
      useTextarea({
        textAreaRef: { current: textarea },
        submitButtonRef: { current: { click } as unknown as HTMLButtonElement },
        setIsScrollable: jest.fn(),
        canSteer,
      }),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => <RecoilRoot>{children}</RecoilRoot>,
    },
  );
  result.current.handleKeyDown({
    key: 'Enter',
    keyCode: 13,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: jest.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>);
  return click;
};

describe('Enter in the composer while a response is generated', () => {
  beforeEach(() => {
    mockChat.isSubmitting = true;
  });

  it('is swallowed for an ordinary generation, as before', () => {
    expect(pressEnter(false)).not.toHaveBeenCalled();
  });

  it('reaches Send when the composer steers a running research', () => {
    expect(pressEnter(true)).toHaveBeenCalledTimes(1);
  });

  it('sends as usual when nothing is generating', () => {
    mockChat.isSubmitting = false;
    expect(pressEnter(false)).toHaveBeenCalledTimes(1);
  });
});
