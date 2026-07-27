import React from 'react';
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { Agent, AgentCreateParams } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import DeleteButton from '../DeleteButton';

const mockReset = jest.fn();
const mockSetConversation = jest.fn();
const mockSetCurrentAgentId = jest.fn();
const DEFAULT_FORM_VALUES = { name: '' };
let mutationOptions: {
  onSuccess?: (data: void, variables: { agent_id: string }, context: unknown) => void;
} = {};

jest.mock('react-hook-form', () => ({
  useFormContext: () => ({ reset: mockReset }),
}));

jest.mock('recoil', () => ({
  useRecoilValue: () => 'agent_1',
  useSetRecoilState: () => mockSetConversation,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    conversationByIndex: jest.fn(),
    conversationAgentIdByIndex: jest.fn(),
  },
}));

jest.mock('@librechat/client', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TrashIcon: () => <span />,
  OGDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogTemplate: () => <div />,
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useDeleteAgentMutation: (options: typeof mutationOptions) => {
    mutationOptions = options;
    return { mutate: jest.fn() };
  },
}));

jest.mock('~/utils', () => ({
  logger: { log: jest.fn() },
  getDefaultAgentFormValues: () => DEFAULT_FORM_VALUES,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const createMutation = {
  data: undefined,
  reset: jest.fn(),
} as unknown as UseMutationResult<Agent, Error, AgentCreateParams>;

const remainingAgents = [{ id: 'agent_2' }, { id: 'agent_3' }] as Agent[];

describe('DeleteButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationOptions = {};
    render(
      <DeleteButton
        agent_id="agent_1"
        setCurrentAgentId={mockSetCurrentAgentId}
        createMutation={createMutation}
      />,
    );
  });

  it('returns to a blank form instead of an arbitrary remaining agent', () => {
    act(() => {
      mutationOptions.onSuccess?.(undefined, { agent_id: 'agent_1' }, remainingAgents);
    });

    expect(mockSetCurrentAgentId).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentAgentId).toHaveBeenCalledWith(undefined);
    expect(mockReset).toHaveBeenCalledWith(DEFAULT_FORM_VALUES);
  });

  it('clears the agent of the active conversation when it was the deleted one', () => {
    act(() => {
      mutationOptions.onSuccess?.(undefined, { agent_id: 'agent_1' }, remainingAgents);
    });

    const updater = mockSetConversation.mock.calls[0][0];
    expect(updater({ agent_id: 'agent_1', model: 'gpt-4' })).toEqual({ agent_id: '', model: '' });
  });

  it('leaves the conversation untouched when another agent was deleted', () => {
    act(() => {
      mutationOptions.onSuccess?.(undefined, { agent_id: 'agent_9' }, remainingAgents);
    });

    expect(mockSetConversation).not.toHaveBeenCalled();
    expect(mockSetCurrentAgentId).toHaveBeenCalledWith(undefined);
  });
});
