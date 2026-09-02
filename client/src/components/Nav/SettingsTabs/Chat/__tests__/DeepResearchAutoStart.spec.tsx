import React from 'react';
import { PermissionTypes } from 'librechat-data-provider';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { render, screen, fireEvent } from '@testing-library/react';
import DeepResearchAutoStart from '../DeepResearchAutoStart';
import { drAutoStartAtom } from '~/store/deepResearch';

let mockPlanGate = true;
let mockDenied: string[] = [];
/* Storage-atom writes go through the platform helper; reached lazily through a
 * `mock`-prefixed name because a mock factory may not touch globals directly. */
const mockWriteStoredValue = (key: string, value: string) => localStorage.setItem(key, value);

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: mockPlanGate ? { deepResearch: { planGate: true } } : {},
  }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: ({ permissionType }: { permissionType: string }) =>
    !mockDenied.includes(permissionType),
}));
jest.mock('@librechat/client', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
    ...rest
  }: {
    id: string;
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
    'data-testid'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      data-testid={rest['data-testid']}
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
  SettingRow: ({
    id,
    title,
    description,
    control,
  }: {
    id: string;
    title: string;
    description?: string;
    control: (ids: { labelId: string; descriptionId: string }) => React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {control({ labelId: `${id}-label`, descriptionId: `${id}-desc` })}
    </div>
  ),
  writeStoredValue: (key: string, value: string) => mockWriteStoredValue(key, value),
}));

const renderWith = (store = createStore()) => {
  render(
    <JotaiProvider store={store}>
      <DeepResearchAutoStart />
    </JotaiProvider>,
  );
  return store;
};

describe('«Запускать исследование сразу» (r30)', () => {
  beforeEach(() => {
    mockPlanGate = true;
    mockDenied = [];
    localStorage.clear();
  });

  it('shows, off by default, with its explanation on screen (canon §6.4: a line, not an «i»)', () => {
    renderWith();
    expect(screen.getByTestId('drAutoStart')).not.toBeChecked();
    expect(screen.getByText('com_nav_dr_auto_start')).toBeInTheDocument();
    expect(screen.getByText('com_nav_dr_auto_start_desc')).toBeInTheDocument();
  });

  it('turning it on is what the plan card reads', () => {
    const store = renderWith();
    fireEvent.click(screen.getByTestId('drAutoStart'));
    expect(store.get(drAutoStartAtom)).toBe(true);
  });

  it('is absent while the plan gate is off — there is no plan card to skip', () => {
    mockPlanGate = false;
    renderWith();
    expect(screen.queryByTestId('drAutoStart')).toBeNull();
  });

  it('is absent for someone who cannot start a research at all', () => {
    mockDenied = [PermissionTypes.DEEP_RESEARCH];
    renderWith();
    expect(screen.queryByTestId('drAutoStart')).toBeNull();
    mockDenied = [PermissionTypes.WEB_SEARCH];
    renderWith();
    expect(screen.queryByTestId('drAutoStart')).toBeNull();
  });
});
