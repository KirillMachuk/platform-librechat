import React from 'react';
import { renderHook } from '@testing-library/react';
import useMentions from '../useMentions';

const AGENTS: Array<{ id: string; name: string }> = [];

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({
    data: { '1ma': ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol'] },
    isLoading: false,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetPresetsQuery: () => ({ data: [], isLoading: false }),
  useGetStartupConfig: () => ({
    data: { interface: { modelSelect: true, presets: false } },
    isLoading: false,
  }),
  useGetEndpointsQuery: ({ select }: { select?: (data: unknown) => unknown } = {}) => {
    const data = { '1ma': { type: 'custom' }, agents: {} };
    return { data: select ? select(data) : data, isLoading: false };
  },
  useListAgentsQuery: (_params: unknown, options: { select?: (res: unknown) => unknown }) => ({
    data: options?.select?.({ data: AGENTS }) ?? [],
    isLoading: false,
  }),
}));

jest.mock('~/hooks/Assistants/useAssistantListMap', () => ({
  __esModule: true,
  default: () => ({}),
}));

jest.mock('~/Providers/AgentsMapContext', () => ({
  useAgentsMapContext: () => ({}),
}));

jest.mock('~/hooks/Roles/useHasAccess', () => ({
  __esModule: true,
  default: () => true,
}));

jest.mock('~/components/Endpoints', () => ({
  EndpointIcon: () => <span data-testid="endpoint-icon" />,
}));

jest.mock('~/components/Chat/Menus/Endpoints/components/brand', () => ({
  getModelBrandIcon: (model: string) => <span data-testid={`brand-${model}`} />,
}));

const renderMentions = () =>
  renderHook(() => useMentions({ assistantMap: {}, includeAssistants: false })).result.current;

describe('useMentions options', () => {
  beforeEach(() => {
    AGENTS.length = 0;
  });

  it('names models like the model selector does, not by their raw id', () => {
    const { options } = renderMentions();

    const models = options.filter((o) => o.type === 'model');
    expect(models.map((m) => m.label)).toEqual(['claude-sonnet-5', 'gpt-5.6-sol']);
  });

  it('keeps the full model id so selecting one still resolves the real model', () => {
    const { options } = renderMentions();

    expect(options.find((o) => o.label === 'claude-sonnet-5')?.modelId).toBe(
      'anthropic/claude-sonnet-5',
    );
  });

  it('draws models with the brand icon the selector uses', () => {
    const { options } = renderMentions();

    const icon = options.find((o) => o.label === 'gpt-5.6-sol')?.icon as React.ReactElement;
    expect(icon.props['data-testid']).toBe('brand-openai/gpt-5.6-sol');
  });

  it('offers no endpoint rows — they only nested what this list already shows', () => {
    const { options } = renderMentions();

    expect(options.some((o) => o.type === 'endpoint')).toBe(false);
    expect(options.map((o) => o.label)).not.toContain('My Agents');
  });

  it('lists agents alongside models once the user has any', () => {
    AGENTS.push({ id: 'agent_legal', name: 'Юрист' });

    const { options } = renderMentions();

    expect(options.find((o) => o.label === 'Юрист')?.type).toBe('agents');
  });
});
