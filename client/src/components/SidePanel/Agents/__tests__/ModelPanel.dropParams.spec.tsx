import React from 'react';
import { render } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import type { AgentForm } from '~/common';
import ModelPanel from '../ModelPanel';

/**
 * Verifies the E-H5 follow-up: the agent builder's Model panel hides parameters
 * the backend drops (`dropParams`) via the real `filterDroppedParams`, mirroring
 * the Parameters side panel. Only the parameter SOURCE and the leaf setting
 * components are mocked; the filter under test runs for real.
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

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    getSettingsKeys: () => ['combined-key', 'endpoint-key'],
    applyModelAwareDefaults: (params: unknown[]) => params,
    agentParamSettings: {
      'combined-key': [
        { key: 'temperature', component: 'slider', label: 'Temperature' },
        { key: 'stop', component: 'tags', label: 'Stop' },
      ],
    },
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm<AgentForm>({
    defaultValues: {
      provider: '1ma' as AgentForm['provider'],
      model: 'model-x',
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
        models={{ '1ma': ['model-x'] }}
        setActivePanel={jest.fn()}
      />
    </Wrapper>,
  );

describe('ModelPanel – dropParams filtering', () => {
  afterEach(() => {
    mockEndpointsConfig = {};
  });

  it('hides a parameter listed in the endpoint dropParams', () => {
    mockEndpointsConfig = { '1ma': { type: 'custom', dropParams: ['stop'] } };
    const { queryByTestId } = renderPanel();
    expect(queryByTestId('param-temperature')).toBeTruthy();
    expect(queryByTestId('param-stop')).toBeNull();
  });

  it('renders every parameter when the endpoint drops nothing', () => {
    mockEndpointsConfig = { '1ma': { type: 'custom' } };
    const { queryByTestId } = renderPanel();
    expect(queryByTestId('param-temperature')).toBeTruthy();
    expect(queryByTestId('param-stop')).toBeTruthy();
  });
});
