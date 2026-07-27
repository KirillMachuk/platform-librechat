import { fireEvent, render, screen } from '@testing-library/react';
import { SelectorTabs } from '../SelectorTabs';

/**
 * These tabs use roving tabindex, so the unselected tab is deliberately outside
 * the tab order — arrow keys are the ONLY way to reach it. Without them a
 * keyboard user is locked into whichever tab happens to be selected, which is
 * easy to miss because Tab still reaches the selected one and Enter appears to
 * "work" (it re-selects what is already selected).
 */

const renderTabs = (activeTab: 'agents' | 'llm' = 'agents') => {
  const onTabChange = jest.fn();
  render(<SelectorTabs activeTab={activeTab} onTabChange={onTabChange} />);
  return { onTabChange, tabs: screen.getAllByRole('tab') };
};

describe('SelectorTabs keyboard access', () => {
  it('moves to the other tab with ArrowRight and takes focus with it', () => {
    const { onTabChange, tabs } = renderTabs('agents');
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('llm');
    expect(document.activeElement).toBe(tabs[1]);
  });

  it('wraps backwards from the first tab', () => {
    const { onTabChange, tabs } = renderTabs('agents');
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('llm');
  });

  it('wraps forwards from the last tab', () => {
    const { onTabChange, tabs } = renderTabs('llm');
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('agents');
  });

  it('jumps to the ends with Home and End', () => {
    const { onTabChange, tabs } = renderTabs('llm');

    fireEvent.keyDown(tabs[1], { key: 'Home' });
    expect(onTabChange).toHaveBeenCalledWith('agents');

    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(onTabChange).toHaveBeenCalledWith('llm');
  });

  it('leaves every other key to the menu around it', () => {
    const { onTabChange, tabs } = renderTabs('agents');

    // Escape has to reach the Ariakit dialog, Tab has to move focus out, and
    // typing has to reach the search field — so none may be swallowed here.
    for (const key of ['Escape', 'Tab', 'a', 'ArrowDown']) {
      const handled = !fireEvent.keyDown(tabs[0], { key });
      expect(handled).toBe(false);
    }
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('keeps exactly one tab in the tab order, and it is the selected one', () => {
    const { tabs } = renderTabs('llm');

    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(tabs.find((tab) => tab.tabIndex === 0)).toHaveAttribute('aria-selected', 'true');
  });

  it('shows focus with an outline that survives the dark theme', () => {
    const { tabs } = renderTabs();

    // ring-ring-primary resolves to the same grey as surface-active in dark mode,
    // so the focus ring on the selected tab was invisible (1:1).
    for (const tab of tabs) {
      expect(tab.className).toContain('focus-visible:outline-text-primary');
      expect(tab.className).not.toContain('ring-ring-primary');
    }
  });

  it('never marks the selected tab by weight alone', () => {
    const { tabs } = renderTabs('agents');
    const weightOf = (el: HTMLElement) =>
      (el.className.match(/font-(thin|light|normal|medium|semibold|bold)/) ?? [])[0];

    expect(weightOf(tabs[0])).toBe(weightOf(tabs[1]));
  });
});
