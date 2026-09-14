import React from 'react';
import 'test/matchMedia.mock';
import { render } from '@testing-library/react';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import StackedMCPIcons from '../StackedMCPIcons';

/**
 * The first axe scan to reach the chat (design review 02.09, item 16) failed
 * on the MCP chip: its icon stack is hidden from assistive tech, yet each icon
 * was a tooltip anchor — a focusable div inside an aria-hidden wrapper inside
 * the chip's own button. A keyboard user landed on stops a screen reader could
 * not announce. The stack is decoration; the chip's text and the menu name the
 * servers.
 */
const server = (serverName: string): MCPServerDefinition =>
  ({
    serverName,
    config: { title: serverName, iconPath: `/icons/${serverName}.png` },
    effectivePermissions: 1,
  }) as unknown as MCPServerDefinition;

describe('StackedMCPIcons', () => {
  it('hides the stack from assistive tech and keeps nothing focusable inside it', () => {
    const { container } = render(
      <StackedMCPIcons selectedServers={[server('google'), server('jira')]} />,
    );
    const stack = container.querySelector('[aria-hidden="true"]');
    expect(stack).not.toBeNull();
    expect(stack!.querySelectorAll('img')).toHaveLength(2);
    expect(stack!.querySelectorAll('[tabindex], button, a[href], [role="button"]')).toHaveLength(0);
  });
});
