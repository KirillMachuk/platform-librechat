import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import type { MutableSnapshot } from 'recoil';
import Header from '../Header';
import store from '~/store';

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: { interface: { presets: true, modelSelect: true } },
  }),
  useGetProjectQuery: () => ({ data: undefined }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => true,
}));

jest.mock('./../Menus/Endpoints/ModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="model-selector" />,
}));

jest.mock('./../Menus', () => ({
  OpenSidebar: () => null,
  PresetsMenu: () => <div data-testid="presets-menu" />,
}));

jest.mock('./../Menus/BookmarkMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="bookmark-menu" />,
}));

jest.mock('./../ExportAndShareMenu', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('./../TemporaryChat', () => ({
  TemporaryChat: () => null,
}));

jest.mock('./../AddMultiConvo', () => ({
  __esModule: true,
  default: () => <div data-testid="add-multi-convo" />,
}));

const renderHeader = (overrides?: (snapshot: MutableSnapshot) => void) =>
  render(
    <RecoilRoot
      initializeState={(snapshot) => {
        overrides?.(snapshot);
      }}
    >
      <Header />
    </RecoilRoot>,
  );

describe('Chat header power-user menus', () => {
  it('hides the presets and bookmarks menus by default', () => {
    renderHeader();

    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
    expect(screen.queryByTestId('presets-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-menu')).not.toBeInTheDocument();
  });

  it('shows the presets menu once the user turns it on', () => {
    renderHeader(({ set }) => set(store.showPresetsMenu, true));

    expect(screen.getByTestId('presets-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-menu')).not.toBeInTheDocument();
  });

  it('shows the bookmarks menu once the user turns it on', () => {
    renderHeader(({ set }) => set(store.showBookmarksMenu, true));

    expect(screen.getByTestId('bookmark-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('presets-menu')).not.toBeInTheDocument();
  });

  it('keeps the model comparison button, which is not gated', () => {
    renderHeader();

    expect(screen.getByTestId('add-multi-convo')).toBeInTheDocument();
  });
});
