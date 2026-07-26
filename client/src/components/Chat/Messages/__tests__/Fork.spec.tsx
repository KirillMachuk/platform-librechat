import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { ForkOptions } from 'librechat-data-provider';
import Fork from '../Fork';

const mockMutate = jest.fn();
const mockNavigateToConvo = jest.fn();
const mockShowToast = jest.fn();
let mutationHandlers: {
  onSuccess?: (data: { conversation: { conversationId: string } }) => void;
  onError?: (error: unknown) => void;
} = {};

jest.mock('~/data-provider', () => ({
  useForkConvoMutation: (handlers: typeof mutationHandlers) => {
    mutationHandlers = handlers;
    return { mutate: mockMutate };
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNavigateToConvo: () => ({ navigateToConvo: mockNavigateToConvo }),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const defaultProps = {
  messageId: 'msg-2',
  conversationId: 'convo-1',
  forkingSupported: true,
  latestMessageId: 'msg-9',
};

describe('Fork button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forks the visible thread up to this message in one click, without a popover', async () => {
    render(<Fork {...defaultProps} />);

    await userEvent.click(screen.getByTestId('fork-button'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({
      messageId: 'msg-2',
      conversationId: 'convo-1',
      option: ForkOptions.DIRECT_PATH,
      splitAtTarget: false,
      latestMessageId: 'msg-9',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('navigates to the new conversation and confirms it', () => {
    render(<Fork {...defaultProps} />);

    mutationHandlers.onSuccess?.({ conversation: { conversationId: 'convo-2' } });

    expect(mockNavigateToConvo).toHaveBeenCalledWith({ conversationId: 'convo-2' });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_fork_success', status: 'success' }),
    );
  });

  it('tells the user when forks are rate limited', () => {
    render(<Fork {...defaultProps} />);

    mutationHandlers.onError?.({ response: { status: 429 } });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_fork_error_rate_limit', status: 'error' }),
    );
  });

  it.each([
    ['forking is unsupported', { forkingSupported: false }],
    ['there is no conversation', { conversationId: null }],
    ['there is no message', { messageId: '' }],
  ])('renders nothing when %s', (_case, override) => {
    const { container } = render(<Fork {...defaultProps} {...override} />);

    expect(container.firstChild).toBeNull();
  });
});
