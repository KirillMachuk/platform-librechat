import React from 'react';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NavLink } from '~/common';
import { MessagesSquare, NotebookPen } from '~/components/icons';

const mockNewConversation = jest.fn();
const mockClearMessagesCache = jest.fn();

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `mock-conversationByIndex-${counter++}`, default: null }),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
}));

/* The real `cn`, not a join: `Button` merges the row's classes with its own
   through twMerge, which silently drops whichever of two conflicting classes it
   decides lost. A joined stand-in would keep both and report an accent that the
   browser never paints. */
jest.mock('~/utils', () => {
  const { twMerge } = jest.requireActual('tailwind-merge');
  const { clsx } = jest.requireActual('clsx');
  return {
    clearMessagesCache: (...args: unknown[]) => mockClearMessagesCache(...args),
    cn: (...inputs: unknown[]) => twMerge(clsx(inputs)),
  };
});

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  CLOSE_SIDEBAR_ID: 'close-sidebar-button',
}));

/* Логотип в шапке сайдбара берёт название продукта из конфига (белая метка). */
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { appTitle: '1ma' } }),
}));

jest.mock('~/components/Nav/AccountSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="account-settings" />,
}));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => <div data-testid="conversations-section" />,
}));

jest.mock('~/components/Nav/SearchChats', () => ({
  __esModule: true,
  SearchChatsRow: () => <div data-testid="search-chats-row" />,
  SearchChatsDialog: () => null,
}));

jest.mock('~/components/UnifiedSidebar/PanelDialog', () => ({
  __esModule: true,
  default: ({
    link,
    open,
  }: {
    link: NavLink | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) => (open && link ? <div data-testid="panel-dialog">{link.title}</div> : null),
}));

import ExpandedPanel from '../ExpandedPanel';

// eslint-disable-next-line i18next/no-literal-string
const PromptsStub = () => <div>prompts-stub</div>;

const createLinks = (): NavLink[] => [
  {
    title: 'com_ui_prompts' as NavLink['title'],
    icon: NotebookPen,
    id: 'prompts',
    Component: PromptsStub,
  },
  {
    title: 'com_ui_bookmarks' as NavLink['title'],
    icon: MessagesSquare,
    id: 'bookmarks',
    Component: PromptsStub,
  },
];

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPanel({
  expanded = true,
  onCollapse = jest.fn(),
  onExpand = jest.fn(),
  links = createLinks(),
}: {
  expanded?: boolean;
  onCollapse?: jest.Mock;
  onExpand?: jest.Mock;
  links?: NavLink[];
} = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={createQueryClient()}>
      <RecoilRoot>
        <MemoryRouter initialEntries={['/c/new']}>{children}</MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>
  );

  const result = render(
    <ExpandedPanel links={links} expanded={expanded} onCollapse={onCollapse} onExpand={onExpand} />,
    { wrapper },
  );

  return { ...result, onCollapse, onExpand };
}

/** Renders a navigate button alongside the panel to simulate in-app navigation (e.g. "Start chat"). */
function renderPanelWithNavigation(links = createLinks()) {
  const NavigateButton = () => {
    const navigate = useNavigate();
    return (
      <button
        data-testid="navigate-away"
        aria-label="navigate-away"
        onClick={() => navigate('/c/new')}
      />
    );
  };

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RecoilRoot>
        <MemoryRouter initialEntries={['/c/new']}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <ExpandedPanel links={links} expanded />
                  <NavigateButton />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>,
  );
}

describe('ExpandedPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('expanded mode renders all sections', () => {
    it('renders the toggle button, new chat button, menu items, conversations section, and account settings', async () => {
      renderPanel({ expanded: true });

      expect(screen.getByTestId('close-sidebar-button')).toBeInTheDocument();
      expect(screen.getByTestId('new-chat-button')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_prompts' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_bookmarks' })).toBeInTheDocument();
      expect(screen.getByTestId('conversations-section')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('account-settings')).toBeInTheDocument());
    });
  });

  describe('collapsed mode renders only toggle and new-chat icon', () => {
    it('shows the sidebar toggle and new-chat icon but no menu items', () => {
      renderPanel({ expanded: false });

      expect(screen.getByTestId('open-sidebar-button')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_prompts' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_bookmarks' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('conversations-section')).not.toBeInTheDocument();
    });
  });

  describe('toggle button behaviour', () => {
    it('calls onCollapse when clicking the toggle while expanded', () => {
      const { onCollapse } = renderPanel({ expanded: true });
      fireEvent.click(screen.getByTestId('close-sidebar-button'));
      expect(onCollapse).toHaveBeenCalledTimes(1);
    });

    it('calls onExpand when clicking the toggle while collapsed', () => {
      const { onExpand } = renderPanel({ expanded: false });
      fireEvent.click(screen.getByTestId('open-sidebar-button'));
      expect(onExpand).toHaveBeenCalledTimes(1);
    });
  });

  describe('new chat button', () => {
    it('calls newConversation when clicking the new chat link', () => {
      renderPanel({ expanded: true });
      const link = screen.getByTestId('new-chat-button');
      fireEvent.click(link);
      expect(mockNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  describe('menu item opens PanelDialog', () => {
    it('opens the dialog with the link title when a menu item is clicked', () => {
      renderPanel({ expanded: true });
      expect(screen.queryByTestId('panel-dialog')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));

      expect(screen.getByTestId('panel-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('panel-dialog')).toHaveTextContent('com_ui_prompts');
    });
  });

  describe('the section whose panel is open wears the accent', () => {
    it('tints that row and its icon, and leaves every other row neutral', () => {
      renderPanel({ expanded: true });

      const prompts = screen.getByTestId('sidebar-link-prompts');
      const bookmarks = screen.getByTestId('sidebar-link-bookmarks');
      const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

      expect(classesOf(prompts)).toContain('text-text-secondary');
      expect(classesOf(prompts)).not.toContain('bg-ring-primary-soft');

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));

      /* Canon §6.5: acc-soft fill, acc text — and the t2 it replaces must be
         gone, or twMerge kept the wrong one of the pair. */
      expect(classesOf(prompts)).toContain('bg-ring-primary-soft');
      expect(classesOf(prompts)).toContain('text-text-accent');
      expect(classesOf(prompts)).not.toContain('text-text-secondary');
      expect(classesOf(bookmarks)).not.toContain('bg-ring-primary-soft');
      expect(classesOf(bookmarks)).toContain('text-text-secondary');

      /* The icon carries the accent too, not just the label. */
      const icon = prompts.querySelector('svg');
      expect(icon).not.toBeNull();
      expect((icon as SVGElement).getAttribute('class')?.split(/\s+/)).toContain(
        'text-text-accent',
      );
    });
  });

  describe('unrelated navigation keeps PanelDialog open', () => {
    it('stays open when the app navigates for its own reasons (panel content dismisses itself)', async () => {
      renderPanelWithNavigation();

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));
      expect(screen.getByTestId('panel-dialog')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('navigate-away'));

      await waitFor(() => expect(screen.getByTestId('panel-dialog')).toBeInTheDocument());
    });
  });
});
