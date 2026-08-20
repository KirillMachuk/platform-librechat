import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecoilRoot } from 'recoil';

/* The phone drawer is hand-rolled (no dialog library), so nothing fences its
 * gestures for free. Founding case (owner 19.08): a swipe at the chats list's
 * top edge chained into the chat BEHIND the scrim — the platform stole the
 * gesture and its momentum locked the list out. The fence is two classes:
 * `overscroll-contain` on the drawer root and `touch-none` on the scrim
 * button. This spec pins both. */

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => true,
}));

jest.mock('~/Providers', () => ({
  ChatContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  ChatFormProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ActivePanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('~/hooks', () => ({
  useChatHelpers: () => ({}),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/Nav/useUnifiedSidebarLinks', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('../ExpandedPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="expanded-panel" />,
}));

jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="rail" />,
}));

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  return {
    __esModule: true,
    default: {
      sidebarExpanded: atom({ key: 'test-drawer-expanded', default: true }),
    },
  };
});

jest.mock('~/utils', () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(' '),
}));

import UnifiedSidebar from '../UnifiedSidebar';

describe('phone drawer gesture fence (owner 19.08)', () => {
  it('the drawer root contains its own overscroll', () => {
    render(
      <RecoilRoot>
        <UnifiedSidebar />
      </RecoilRoot>,
    );
    const drawer = screen.getByTestId('sidebar-drawer');
    expect(drawer.className).toContain('overscroll-contain');
  });

  it('the scrim swallows touch gestures instead of scrolling the chat behind', () => {
    render(
      <RecoilRoot>
        <UnifiedSidebar />
      </RecoilRoot>,
    );
    const scrim = screen.getByRole('button', { name: 'com_nav_close_sidebar' });
    expect(scrim.className).toContain('touch-none');
  });
});
