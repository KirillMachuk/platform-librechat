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
      /* «Новый чат» на телефоне закрывает шторку (15.08-8) — читает этот атом. */
      sidebarExpanded: atom({ key: `mock-sidebarExpanded-${counter++}`, default: true }),
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

    /* Owner 20.08-2: the card look (hairline + card bg) is the whole
     * distinction — the prototype's extra mb-2.5/mt-1.5 made its spacing
     * differ from every other row and was removed. An unguarded look
     * decision gets silently reverted (#265) — this pins the removal. */
    it('carries no margins of its own — row spacing is uniform', () => {
      renderPanel({ expanded: true });
      const link = screen.getByTestId('new-chat-button');
      expect(link.className).not.toMatch(/(^|\s)-?m[bty]?-/);
    });
  });

  describe('one scroller, fenced edges (owner р21-4)', () => {
    /* The two-scroller layout (nav min-h-0 + chats with a guaranteed 240px)
     * left dead zones — a swipe from the «Чаты» header or the profile strip
     * chained to the platform behind the phone drawer. The whole panel now
     * scrolls as ONE element; the header and profile strips swallow touches. */
    it('the chats section rides INSIDE the single panel scroller', () => {
      /* The one-scroller claim is structural: the conversations section must
       * be a DESCENDANT of the overflow-y-auto element (pre-r21 it was a
       * sibling block with its own inner scroller — a bare scroller count
       * stays green there because the section is mocked). */
      const { container } = renderPanel({ expanded: true });
      const scroller = container.querySelector('[class*="overflow-y-auto"]');
      expect(scroller).not.toBeNull();
      expect(scroller?.querySelector('[data-testid="conversations-section"]')).not.toBeNull();
      expect(container.querySelectorAll('[class*="overflow-y-auto"]').length).toBe(1);
    });

    it('the header and profile strips swallow touch gestures', () => {
      const { container } = renderPanel({ expanded: true });
      const touchFences = container.querySelectorAll('.touch-none');
      expect(touchFences.length).toBeGreaterThanOrEqual(2);
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

  describe('the section whose panel is open wears the neutral tint, never the brand', () => {
    it('tints that row and its icon, and leaves every other row neutral', () => {
      renderPanel({ expanded: true });

      const prompts = screen.getByTestId('sidebar-link-prompts');
      const bookmarks = screen.getByTestId('sidebar-link-bookmarks');
      const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

      /* Owner 11.08: a resting row's label AND icon wear the one sidebar ink
         (the book's t2/t3 pair read as two random greys to him), and the icon
         is the book's 20, not the §4 ladder's 18. */
      expect(classesOf(prompts)).toContain('text-sidebar-ink');
      expect(classesOf(prompts)).not.toContain('text-text-secondary');
      expect(classesOf(prompts)).not.toContain('bg-surface-active');
      const restingIcon = bookmarks.querySelector('svg');
      expect(restingIcon).not.toBeNull();
      const restingIconClasses = (restingIcon as SVGElement).getAttribute('class')?.split(/\s+/);
      expect(restingIconClasses).toContain('text-sidebar-ink');
      expect(restingIconClasses).not.toContain('text-text-tertiary');
      expect(restingIconClasses).toEqual(expect.arrayContaining(['h-5', 'w-5']));

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_prompts' }));

      /* Canon §6.5 as the owner rewrote it on 10.08: the selected row is the
         neutral `active` tint with t1 text — and the resting ink it replaces
         must be gone, or twMerge kept the wrong one of the pair. */
      expect(classesOf(prompts)).toContain('bg-surface-active');
      expect(classesOf(prompts)).toContain('text-text-primary');
      expect(classesOf(prompts)).not.toContain('text-sidebar-ink');
      expect(classesOf(bookmarks)).not.toContain('bg-surface-active');
      expect(classesOf(bookmarks)).toContain('text-sidebar-ink');

      /* The guard, not the decoration: §1.1 excludes a sidebar section from the
         exhaustive list of places the brand petrol may appear, so the petrol
         must be provably absent — from the row AND from its icon. This is the
         assertion that stops the decision from being reverted by the next
         person who reads the old §6.5. */
      expect(classesOf(prompts)).not.toContain('bg-acc-soft');
      expect(classesOf(prompts)).not.toContain('text-text-accent');

      /* The icon carries the same neutral t1, not just the label. */
      const icon = prompts.querySelector('svg');
      expect(icon).not.toBeNull();
      const iconClasses = (icon as SVGElement).getAttribute('class')?.split(/\s+/);
      expect(iconClasses).toContain('text-text-primary');
      expect(iconClasses).not.toContain('text-text-accent');
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
