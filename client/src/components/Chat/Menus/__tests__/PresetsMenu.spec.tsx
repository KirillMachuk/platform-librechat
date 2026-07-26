import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { MutableSnapshot } from 'recoil';
import PresetsMenu from '../PresetsMenu';
import store from '~/store';

const mockUsePresets = jest.fn(() => ({
  presetsQuery: { data: [] },
  onSetDefaultPreset: jest.fn(),
  onFileSelected: jest.fn(),
  onSelectPreset: jest.fn(),
  onChangePreset: jest.fn(),
  clearAllPresets: jest.fn(),
  onDeletePreset: jest.fn(),
  submitPreset: jest.fn(),
  exportPreset: jest.fn(),
  showDeleteDialog: false,
  setShowDeleteDialog: jest.fn(),
  presetToDelete: null,
  confirmDeletePreset: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  usePresets: () => mockUsePresets(),
}));

jest.mock('../Presets', () => ({
  EditPresetDialog: () => null,
  PresetItems: () => null,
}));

const renderMenu = (initialize?: (snapshot: MutableSnapshot) => void) =>
  render(
    <RecoilRoot initializeState={(snapshot) => initialize?.(snapshot)}>
      <PresetsMenu />
    </RecoilRoot>,
  );

describe('PresetsMenu', () => {
  beforeEach(() => {
    mockUsePresets.mockClear();
  });

  it('renders nothing until the user turns presets on', () => {
    const { container } = renderMenu();

    expect(container.firstChild).toBeNull();
  });

  it('still loads presets while hidden, so a default preset keeps applying', () => {
    renderMenu();

    /** usePresets owns the default-preset bootstrap; gating above it would kill it. */
    expect(mockUsePresets).toHaveBeenCalled();
  });

  it('shows the trigger once the user turns presets on', () => {
    renderMenu(({ set }) => set(store.showPresetsMenu, true));

    expect(screen.getByRole('button', { name: 'com_endpoint_examples' })).toBeInTheDocument();
  });
});
