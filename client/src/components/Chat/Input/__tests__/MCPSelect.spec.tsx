import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import MCPSelect from '../MCPSelect';

const mockToggleServerSelection = jest.fn();

const defaultMcpServerManager = {
  localize: (key: string) => key,
  isPinned: true,
  mcpValues: [] as string[],
  placeholderText: 'MCP Servers',
  selectableServers: [
    { serverName: 'server-a', config: { title: 'Server A' } },
    { serverName: 'server-b', config: { title: 'Server B' } },
  ],
  connectionStatus: {},
  isInitializing: () => false,
  getConfigDialogProps: () => null,
  toggleServerSelection: mockToggleServerSelection,
  getServerStatusIconProps: () => null,
};

let mockCanUseMcp = true;
let mockMcpServerManager = { ...defaultMcpServerManager };

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    conversationId: 'test-conv',
    storageContextKey: undefined,
    mcpServerManager: mockMcpServerManager,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => mockCanUseMcp,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    TooltipAnchor: ({
      children,
      render,
    }: {
      children: React.ReactNode;
      render: React.ReactElement;
    }) => R.cloneElement(render, {}, ...(Array.isArray(children) ? children : [children])),
    MCPIcon: ({ className }: { className?: string }) => R.createElement('span', { className }),
    Spinner: ({ className }: { className?: string }) => R.createElement('span', { className }),
    /* Sentinels, not the real strings: the tests below assert the MCP pill
       draws from the shared chip recipe rather than what the recipe says. */
    CHIP_BASE: 'test-chip-base',
    CHIP_CHECKED: 'test-chip-checked',
  };
});

jest.mock('~/components/MCP/MCPConfigDialog', () => ({
  __esModule: true,
  default: () => null,
}));

/**
 * `userEvent` waits on a timer between every dispatched event, and a single
 * click is a whole sequence of them (pointer, mouse, focus, click). Running the
 * full suite in parallel stretches those timers: interactions that take ~80ms on
 * their own overran Jest's 5s default and failed the suite intermittently.
 *
 * The timeout is raised rather than the event timing changed — `delay: null`
 * dispatches synchronously and breaks the arrow-key test, whose focus handling
 * genuinely needs the ticks between key presses.
 */
jest.setTimeout(20000);

describe('MCPSelect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanUseMcp = true;
    mockMcpServerManager = { ...defaultMcpServerManager };
  });

  it('renders the menu button', () => {
    render(<MCPSelect />);
    expect(screen.getByRole('button', { name: /MCP Servers/i })).toBeInTheDocument();
  });

  /* §6.3: the MCP pill is a tool chip — same shared recipe, same 34 height,
     and the neutral "on" fill once servers are selected. It used to carry its
     own hand-copied 36px look, which the owner read as a stray white pill. */
  it('wears the shared chip recipe', () => {
    render(<MCPSelect />);
    const button = screen.getByRole('button', { name: /MCP Servers/i });
    expect(button.className).toContain('test-chip-base');
    expect(button.className).toContain('h-[34px]');
    expect(button.className).not.toContain('test-chip-checked');
  });

  it('wears the checked chip fill when servers are selected', () => {
    mockMcpServerManager = { ...defaultMcpServerManager, mcpValues: ['server-a'] };
    render(<MCPSelect />);
    const button = screen.getByRole('button', { name: /Server A/i });
    expect(button.className).toContain('test-chip-base');
    expect(button.className).toContain('test-chip-checked');
  });

  it('opens menu on button click and shows server items', async () => {
    const user = userEvent.setup();
    render(<MCPSelect />);

    await user.click(screen.getByRole('button', { name: /MCP Servers/i }));

    const menu = screen.getByRole('menu', { name: /com_ui_mcp_servers/i });
    expect(menu).toBeVisible();
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Server A/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Server B/i })).toBeInTheDocument();
  });

  it('closes menu on Escape', async () => {
    const user = userEvent.setup();
    render(<MCPSelect />);

    await user.click(screen.getByRole('button', { name: /MCP Servers/i }));
    expect(screen.getByRole('menu', { name: /com_ui_mcp_servers/i })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /MCP Servers/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps menu open after toggling a server item', async () => {
    const user = userEvent.setup();
    render(<MCPSelect />);

    await user.click(screen.getByRole('button', { name: /MCP Servers/i }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Server A/i }));

    expect(mockToggleServerSelection).toHaveBeenCalledWith('server-a');
    expect(screen.getByRole('menu', { name: /com_ui_mcp_servers/i })).toBeVisible();
  });

  it('arrow-key navigation wraps from last item to first', async () => {
    const user = userEvent.setup();
    render(<MCPSelect />);

    await user.click(screen.getByRole('button', { name: /MCP Servers/i }));
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(2);

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
  });

  it('renders nothing when user lacks MCP access', () => {
    mockCanUseMcp = false;
    const { container } = render(<MCPSelect />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing when selectableServers is empty', () => {
    mockMcpServerManager = { ...defaultMcpServerManager, selectableServers: [] };
    const { container } = render(<MCPSelect />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when not pinned and no servers selected', () => {
    mockMcpServerManager = { ...defaultMcpServerManager, isPinned: false, mcpValues: [] };
    const { container } = render(<MCPSelect />);
    expect(container.firstChild).toBeNull();
  });
});
