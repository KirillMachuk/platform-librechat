import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { Agent } from 'librechat-data-provider';
import DuplicateAgent from '../DuplicateAgent';

const mockMutate = jest.fn();
const mockSetCurrentAgentId = jest.fn();
let mutationOptions: {
  onSuccess?: (data: { agent: Agent; actions: [] }) => void;
} = {};

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: jest.fn() }),
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    'aria-label': string;
  }) => (
    <button aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  ),
}));

jest.mock('~/data-provider', () => ({
  useDuplicateAgentMutation: (options: typeof mutationOptions) => {
    mutationOptions = options;
    return { mutate: mockMutate };
  },
}));

jest.mock('~/Providers/AgentPanelContext', () => ({
  useAgentPanelContext: () => ({ setCurrentAgentId: mockSetCurrentAgentId }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('DuplicateAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutationOptions = {};
  });

  it('opens the duplicated agent in the builder', () => {
    render(<DuplicateAgent agent_id="agent_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_duplicate_agent' }));
    expect(mockMutate).toHaveBeenCalledWith({ agent_id: 'agent_1' });

    act(() => {
      mutationOptions.onSuccess?.({ agent: { id: 'agent_1_copy' } as Agent, actions: [] });
    });

    expect(mockSetCurrentAgentId).toHaveBeenCalledWith('agent_1_copy');
  });
});
