import React from 'react';
import { render, screen } from '@testing-library/react';
import SiblingHeader from '../SiblingHeader';

const endpointsConfig = {
  '1ma': { modelDisplayLabel: 'Все модели' },
};

const agentsMap: Record<string, { id: string; name: string; model: string }> = {
  agent_legal: { id: 'agent_legal', name: 'Юрист', model: 'anthropic/claude-sonnet-5' },
};

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: endpointsConfig }),
}));

jest.mock('~/data-provider/Messages', () => ({
  useBranchMessageMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => agentsMap,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/components/Share/MessageIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Chat/Messages/ui/MessageTimestamp', () => ({
  __esModule: true,
  default: () => null,
}));

const renderHeader = (agentId: string) =>
  render(
    <SiblingHeader
      agentId={agentId}
      messageId="m1"
      conversationId="c1"
      createdAt="2026-07-26T10:00:00.000Z"
      isSubmitting={false}
    />,
  );

describe('SiblingHeader name of a parallel answer', () => {
  it('names the model when the sender is only the endpoint label shared by all models', () => {
    /** Two columns on the same custom endpoint would otherwise read identically. */
    renderHeader('1ma__anthropic/claude-sonnet-5___Все модели');

    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.queryByText('Все модели')).not.toBeInTheDocument();
  });

  it('keeps a sender that says something the model id does not', () => {
    renderHeader('1ma__anthropic/claude-sonnet-5___Sonnet 5');

    expect(screen.getByText('Sonnet 5')).toBeInTheDocument();
  });

  it('still names a real agent by its name', () => {
    renderHeader('agent_legal');

    expect(screen.getByText('Юрист')).toBeInTheDocument();
  });
});
