import React from 'react';
import { render, screen } from '@testing-library/react';
import ToolsDropdown from '../ToolsDropdown';

/**
 * Reasoning models (o-series / gpt-5.x) cannot run the tool loop, so the tools menu
 * must omit the toggles that arm one (web search, run code, file search, MCP) while
 * keeping the ones that still work (Deep Research forces a non-reasoning model;
 * Artifacts and Skills are not tool-loop tools). Mirrors the backend gating in
 * loadEphemeralAgent / loadAddedAgent.
 */

let mockIsReasoningModelActive = false;

const makeToggle = () => ({
  toggleState: false,
  debouncedChange: jest.fn(),
  isPinned: true,
  setIsPinned: jest.fn(),
  authData: { authenticated: true, authTypes: [] as unknown[] },
});

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    agentsConfig: { capabilities: [] },
    isReasoningModelActive: mockIsReasoningModelActive,
    skills: makeToggle(),
    webSearch: makeToggle(),
    deepResearch: makeToggle(),
    artifacts: makeToggle(),
    fileSearch: makeToggle(),
    codeInterpreter: makeToggle(),
    searchApiKeyForm: {
      setIsDialogOpen: jest.fn(),
      menuTriggerRef: { current: null },
    },
    mcpServerManager: { availableMCPServers: [{ serverName: 'srv-a' }] },
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
  useAgentCapabilities: () => ({
    codeEnabled: true,
    webSearchEnabled: true,
    deepResearchEnabled: true,
    artifactsEnabled: true,
    fileSearchEnabled: true,
    skillsEnabled: true,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: {} } }),
}));

jest.mock('~/components/Chat/Input/ArtifactsSubMenu', () => ({
  __esModule: true,
  default: () => <div>artifacts_item</div>,
}));

jest.mock('~/components/Chat/Input/MCPSubMenu', () => ({
  __esModule: true,
  default: () => <div>mcp_item</div>,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    DropdownPopup: ({ items }: { items: Array<{ render?: (p: object) => React.ReactNode }> }) =>
      R.createElement(
        'div',
        {},
        items.map((item, i) => R.createElement('div', { key: i }, item.render?.({}))),
      ),
    TooltipAnchor: () => null,
    PinIcon: () => null,
    VectorIcon: () => null,
  };
});

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

describe('ToolsDropdown — reasoning-model tool gating', () => {
  afterEach(() => {
    mockIsReasoningModelActive = false;
  });

  it('shows every enabled tool for a non-reasoning model', () => {
    mockIsReasoningModelActive = false;
    render(<ToolsDropdown />);

    expect(screen.getByText('com_ui_web_search')).toBeInTheDocument();
    expect(screen.getByText('com_ui_run_code')).toBeInTheDocument();
    expect(screen.getByText('com_assistants_file_search')).toBeInTheDocument();
    expect(screen.getByText('mcp_item')).toBeInTheDocument();
    expect(screen.getByText('com_ui_deep_research')).toBeInTheDocument();
    expect(screen.getByText('artifacts_item')).toBeInTheDocument();
    expect(screen.getByText('com_ui_skills')).toBeInTheDocument();
  });

  it('hides tool-loop toggles but keeps Deep Research / Artifacts / Skills for a reasoning model', () => {
    mockIsReasoningModelActive = true;
    render(<ToolsDropdown />);

    expect(screen.queryByText('com_ui_web_search')).not.toBeInTheDocument();
    expect(screen.queryByText('com_ui_run_code')).not.toBeInTheDocument();
    expect(screen.queryByText('com_assistants_file_search')).not.toBeInTheDocument();
    expect(screen.queryByText('mcp_item')).not.toBeInTheDocument();

    expect(screen.getByText('com_ui_deep_research')).toBeInTheDocument();
    expect(screen.getByText('artifacts_item')).toBeInTheDocument();
    expect(screen.getByText('com_ui_skills')).toBeInTheDocument();
  });
});
