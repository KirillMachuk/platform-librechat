import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import type t from 'librechat-data-provider';

const mockNewConversation = jest.fn();
const mockHasPermission = jest.fn(() => false);
let mockUser: { id: string; role: string } = { id: 'user_other', role: 'USER' };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDefaultConvo: () => jest.fn(() => ({})),
  useFavorites: () => ({
    isFavoriteAgent: jest.fn(() => false),
    toggleFavoriteAgent: jest.fn(),
  }),
  useAuthContext: () => ({ user: mockUser }),
}));

jest.mock('~/hooks/useResourcePermissions', () => ({
  useResourcePermissions: () => ({ hasPermission: mockHasPermission, isLoading: false }),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: null, newConversation: mockNewConversation }),
}));

jest.mock('~/utils', () => ({
  renderAgentAvatar: () => <div data-testid="agent-avatar" />,
  clearMessagesCache: jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import AgentDetailContent from '../AgentDetailContent';

const agent = {
  _id: 'db_1',
  id: 'agent_1',
  name: 'Test Agent',
  description: 'An agent',
  author: 'user_owner',
} as unknown as t.Agent;

function renderContent(props: { onEdit?: () => void; onStartChat?: () => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDetailContent agent={agent} {...props} />
    </QueryClientProvider>,
  );
}

describe('AgentDetailContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
    mockUser = { id: 'user_other', role: 'USER' };
  });

  describe('start chat', () => {
    it('dismisses the surrounding panel after creating the conversation', () => {
      const onStartChat = jest.fn();
      renderContent({ onStartChat });

      fireEvent.click(screen.getByRole('button', { name: 'com_agents_start_chat' }));

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(onStartChat).toHaveBeenCalledTimes(1);
    });

    it('still starts the chat when no dismiss handler is provided', () => {
      renderContent();

      fireEvent.click(screen.getByRole('button', { name: 'com_agents_start_chat' }));

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  describe('edit button visibility', () => {
    it('is hidden for a user without edit rights', () => {
      renderContent({ onEdit: jest.fn() });

      expect(screen.queryByTestId('agent-detail-edit-button')).not.toBeInTheDocument();
    });

    it('is shown to the agent author', () => {
      mockUser = { id: 'user_owner', role: 'USER' };
      renderContent({ onEdit: jest.fn() });

      expect(screen.getByTestId('agent-detail-edit-button')).toBeInTheDocument();
    });

    it('is shown to an admin', () => {
      mockUser = { id: 'user_other', role: 'ADMIN' };
      renderContent({ onEdit: jest.fn() });

      expect(screen.getByTestId('agent-detail-edit-button')).toBeInTheDocument();
    });

    it('is shown to a user granted the EDIT permission bit', () => {
      mockHasPermission.mockReturnValue(true);
      renderContent({ onEdit: jest.fn() });

      expect(screen.getByTestId('agent-detail-edit-button')).toBeInTheDocument();
    });

    it('is hidden when the catalog provides no edit handler', () => {
      mockUser = { id: 'user_owner', role: 'USER' };
      renderContent();

      expect(screen.queryByTestId('agent-detail-edit-button')).not.toBeInTheDocument();
    });

    it('invokes the edit handler on click', () => {
      mockUser = { id: 'user_owner', role: 'USER' };
      const onEdit = jest.fn();
      renderContent({ onEdit });

      fireEvent.click(screen.getByTestId('agent-detail-edit-button'));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });
});
