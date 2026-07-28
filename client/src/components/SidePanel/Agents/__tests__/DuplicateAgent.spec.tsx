import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { Agent } from 'librechat-data-provider';
import DuplicateAgent from '../DuplicateAgent';

const mockMutate = jest.fn();
const mockSetCurrentAgentId = jest.fn();
const mockShowToast = jest.fn();
let mutationOptions: {
  onSuccess?: (data: { agent: Agent; actions: [] }) => void;
} = {};
let mockIsDirty = false;
let mockIsLoading = false;

jest.mock('react-hook-form', () => ({
  useFormState: () => ({ isDirty: mockIsDirty }),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    'aria-label': string;
  }) => (
    <button aria-label={ariaLabel} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

jest.mock('~/data-provider', () => ({
  useDuplicateAgentMutation: (options: typeof mutationOptions) => {
    mutationOptions = options;
    return { mutate: mockMutate, isLoading: mockIsLoading };
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
    mockIsDirty = false;
    mockIsLoading = false;
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

  it('stays on the current agent when the form has unsaved edits', () => {
    mockIsDirty = true;
    render(<DuplicateAgent agent_id="agent_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_duplicate_agent' }));
    act(() => {
      mutationOptions.onSuccess?.({ agent: { id: 'agent_1_copy' } as Agent, actions: [] });
    });

    // Navigating away would discard the edits — the copy is still created.
    expect(mockSetCurrentAgentId).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_agent_duplicated_stayed' }),
    );
  });

  it('cannot be fired twice while a duplicate is in flight', () => {
    mockIsLoading = true;
    render(<DuplicateAgent agent_id="agent_1" />);

    const button = screen.getByRole('button', { name: 'com_ui_duplicate_agent' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
