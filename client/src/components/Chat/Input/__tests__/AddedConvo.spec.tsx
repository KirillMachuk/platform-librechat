import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TConversation } from 'librechat-data-provider';
import AddedConvo from '../AddedConvo';

const endpointsConfig = {
  '1ma': { modelDisplayLabel: 'Все модели' },
};

const agentsMap = {
  agent_abc: { id: 'agent_abc', name: 'Юрист' },
};

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: endpointsConfig }),
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => agentsMap,
}));

jest.mock('~/components/Endpoints', () => ({
  EndpointIcon: () => null,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

/** Custom endpoints ('1ma') are plain strings at runtime, unlike the built-in enum. */
type ConvoFixture = Omit<Partial<TConversation>, 'endpoint'> & { endpoint?: string | null };

const renderTitle = (addedConvo: ConvoFixture | null) =>
  render(<AddedConvo addedConvo={addedConvo as TConversation | null} setAddedConvo={jest.fn()} />);

describe('AddedConvo title', () => {
  it('names the model, not the endpoint label shared by every model', () => {
    renderTitle({ endpoint: '1ma', model: 'anthropic/claude-sonnet-5' });

    /** Short name, as the model selector and the picker write it. */
    expect(screen.getByText('+ claude-sonnet-5')).toBeInTheDocument();
    expect(screen.queryByText('+ Все модели')).not.toBeInTheDocument();
  });

  it('prefers an explicit model label over the raw model id', () => {
    renderTitle({ endpoint: '1ma', model: 'anthropic/claude-sonnet-5', modelLabel: 'Sonnet 5' });

    expect(screen.getByText('+ Sonnet 5')).toBeInTheDocument();
  });

  it('names the agent when the added conversation is an agent', () => {
    renderTitle({ endpoint: 'agents', agent_id: 'agent_abc', model: 'anthropic/claude-sonnet-5' });

    expect(screen.getByText('+ Юрист')).toBeInTheDocument();
  });

  it('falls back to the endpoint label when no model is set', () => {
    renderTitle({ endpoint: '1ma' });

    expect(screen.getByText('+ Все модели')).toBeInTheDocument();
  });

  it('renders nothing without an added conversation', () => {
    const { container } = renderTitle(null);

    expect(container.firstChild).toBeNull();
  });
});
