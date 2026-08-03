import React from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import type { TUser } from 'librechat-data-provider';
import { AgentApiKeys } from './AgentApiKeys';

const mockUseAuthContext = jest.fn();
const mockUseHasAccess = jest.fn();
const mockUseGetAgentApiKeysQuery = jest.fn();

jest.mock('~/hooks', () => ({
  useAuthContext: () => mockUseAuthContext(),
  useHasAccess: () => mockUseHasAccess(),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useUpdateRemoteAgentsPermissionsMutation: () => ({ mutate: jest.fn() }),
}));

jest.mock('~/components/ui', () => ({
  AdminSettingsDialog: () => <div data-testid="admin-settings" />,
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useGetAgentApiKeysQuery: (options: unknown) => mockUseGetAgentApiKeysQuery(options),
  useCreateAgentApiKeyMutation: () => ({ mutate: jest.fn() }),
  useDeleteAgentApiKeyMutation: () => ({ mutate: jest.fn() }),
}));

const asRole = (role: string): { user: TUser } => ({ user: { id: 'u1', role } as TUser });

const ROW = 'com_ui_agent_api_keys';

describe('AgentApiKeys row visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetAgentApiKeysQuery.mockReturnValue({ data: { keys: [] }, isError: false });
  });

  it('hides the row from an employee who can neither create keys nor holds any', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.USER));
    mockUseHasAccess.mockReturnValue(false);

    render(<AgentApiKeys />);

    expect(screen.queryByText(ROW)).not.toBeInTheDocument();
  });

  it('keeps the row for an employee who still holds a key, so they can revoke it', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.USER));
    mockUseHasAccess.mockReturnValue(false);
    mockUseGetAgentApiKeysQuery.mockReturnValue({
      data: { keys: [{ id: 'k1', name: 'old key', keyPrefix: 'ak_' }] },
      isError: false,
    });

    render(<AgentApiKeys />);

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  it('keeps the row when the list could not be loaded, rather than stranding a key', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.USER));
    mockUseHasAccess.mockReturnValue(false);
    mockUseGetAgentApiKeysQuery.mockReturnValue({ data: undefined, isError: true });

    render(<AgentApiKeys />);

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  it('keeps the row for an employee who may create keys', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.USER));
    mockUseHasAccess.mockReturnValue(true);

    render(<AgentApiKeys />);

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  /** The administrator grants key creation back from inside this very dialog. */
  it('keeps the row for an administrator whose own permission is switched off', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.ADMIN));
    mockUseHasAccess.mockReturnValue(false);

    render(<AgentApiKeys />);

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  it('does not ask for a key list it cannot act on', () => {
    mockUseAuthContext.mockReturnValue(asRole(SystemRoles.ADMIN));
    mockUseHasAccess.mockReturnValue(false);

    render(<AgentApiKeys />);

    expect(mockUseGetAgentApiKeysQuery).toHaveBeenCalledWith({ enabled: false });
  });
});
