import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import AgentHandoff from '../AgentHandoff';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => {
    const translations: Record<string, string> = {
      com_ui_transferred_to: 'Transferred to',
      com_ui_agent: 'Agent',
      com_ui_handoff_instructions: 'Handoff instructions',
    };
    return translations[key] || key;
  },
  useExpandCollapse: (isExpanded: boolean) => ({
    style: {
      display: 'grid',
      gridTemplateRows: isExpanded ? '1fr' : '0fr',
      opacity: isExpanded ? 1 : 0,
    },
    ref: { current: null },
  }),
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => ({
    'agent-123': { name: 'Test Agent' },
  }),
}));

jest.mock('~/components/Share/MessageIcon', () => ({
  __esModule: true,
  default: () => <div data-testid="message-icon" />,
}));

jest.mock('~/components/icons', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' '),
}));

const renderAgentHandoff = (props: {
  name: string;
  args: string | Record<string, unknown>;
  output?: string | null;
}) =>
  render(
    <RecoilRoot>
      <AgentHandoff {...props} />
    </RecoilRoot>,
  );

describe('AgentHandoff - A11Y accessibility stubs', () => {
  it('A11Y-01: renders a semantic button element when hasInfo is true', () => {
    renderAgentHandoff({
      name: 'lc_transfer_to_agent-123',
      args: '{"key":"value"}',
    });

    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
  });

  it('A11Y-02: button has aria-label describing the handoff target', () => {
    renderAgentHandoff({
      name: 'lc_transfer_to_agent-123',
      args: '{"key":"value"}',
    });

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label');
    expect(button.getAttribute('aria-label')).toContain('Transferred to');
    expect(button.getAttribute('aria-label')).toContain('Test Agent');
  });

  it('A11Y-03: button leaves keyboard focus to the global §1.8 outline', () => {
    renderAgentHandoff({
      name: 'lc_transfer_to_agent-123',
      args: '{"key":"value"}',
    });

    /* Focus indication moved out of components: style.css draws one 2px acc
     * outline on every :focus-visible, and `npm run check:focus` fails the
     * build on any hand-rolled ring. What the component must guarantee is
     * only that the button is reachable — a real, enabled button — and that
     * it paints no ring of its own on top of the global outline. */
    const button = screen.getByRole('button');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('tabindex', '-1');
    expect(button.className).not.toMatch(/focus[\w-]*:ring-\d/);
  });

  it('A11Y-03: disabled button is rendered when hasInfo is false', () => {
    renderAgentHandoff({
      name: 'lc_transfer_to_agent-123',
      args: '',
    });

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
