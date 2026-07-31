import React from 'react';
import { render } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import type { AgentForm } from '~/common';
import ModelPanel from '../ModelPanel';

/**
 * The builder is where someone picks a model and then goes on to switch on file
 * search or an MCP server. Learning only when they press Save that the two cannot
 * go together means unpicking the work, so the panel says it while the model is
 * being chosen. Everything but the parameter source is real, including the
 * capability lookup under test.
 */

let mockEndpointsConfig: Record<string, unknown> = {};

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: mockEndpointsConfig }),
}));

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ControlCombobox: () => <div data-testid="control-combobox" />,
}));

jest.mock('~/components/SidePanel/Parameters/components', () => ({
  componentMapping: new Proxy(
    {},
    {
      get:
        () =>
        ({ settingKey }: { settingKey: string }) => <div data-testid={`param-${settingKey}`} />,
    },
  ),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm<AgentForm>({
    defaultValues: {
      provider: '1ma' as AgentForm['provider'],
      model: 'vendor/model-x',
      model_parameters: {},
    },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

const renderPanel = () =>
  render(
    <Wrapper>
      <ModelPanel
        providers={[{ label: '1ma', value: '1ma' }]}
        models={{ '1ma': ['vendor/model-x'] }}
        setActivePanel={jest.fn()}
      />
    </Wrapper>,
  );

describe('ModelPanel – tool support', () => {
  afterEach(() => {
    mockEndpointsConfig = {};
  });

  it('says so when the gateway serves the model without tool support', () => {
    mockEndpointsConfig = {
      '1ma': { type: 'custom', modelCapabilities: { 'vendor/model-x': { tools: false } } },
    };
    const { queryByText } = renderPanel();
    expect(queryByText('com_ui_model_no_tools_hint')).toBeTruthy();
  });

  it('stays quiet for a model that can use tools', () => {
    mockEndpointsConfig = {
      '1ma': { type: 'custom', modelCapabilities: { 'vendor/model-x': { tools: true } } },
    };
    const { queryByText } = renderPanel();
    expect(queryByText('com_ui_model_no_tools_hint')).toBeNull();
  });

  /** Silence from the gateway is "unknown", and guessing would be worse than saying nothing. */
  it('stays quiet when the catalogue said nothing about the model', () => {
    mockEndpointsConfig = {
      '1ma': { type: 'custom', modelCapabilities: { 'vendor/model-x': {} } },
    };
    expect(renderPanel().queryByText('com_ui_model_no_tools_hint')).toBeNull();

    mockEndpointsConfig = { '1ma': { type: 'custom' } };
    expect(renderPanel().queryByText('com_ui_model_no_tools_hint')).toBeNull();
  });
});
