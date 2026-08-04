import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  messagesView,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from '../mock/helpers';

/**
 * Dark theme. The canon calls out contrast in the dark as its own risk — light
 * and dark do not fail in the same places, and the PR gate only ever sees light.
 */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const rules = async (page: Page, within?: string) => {
  const builder = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  const results = await (within ? builder.include(within) : builder).analyze();
  return [...new Set(results.violations.map((violation) => violation.id))].sort();
};

test.describe('dark theme', () => {
  test('the app really renders dark', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(page.locator('form textarea').first()).toBeVisible();

    /* Without this the scans below would silently be light-theme scans that
     * happen to run in a project called "dark". */
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the new chat screen has no WCAG A/AA violations in the dark', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(page.locator('html')).toHaveClass(/dark/);

    expect(await rules(page)).toEqual([]);
  });

  /**
   * Measured, not assumed: the column-header contrast that fails in the light
   * theme (4.34:1) passes in the dark palette, so this scan comes back empty
   * where the PR gate's light one does not. Asserting the empty result is what
   * keeps the dark theme from quietly acquiring the defect later.
   */
  test('the file library is clean in the dark, where the light theme is not', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await page.getByTestId('sidebar-link-files').click();
    await expect(page.locator('div[role="dialog"]')).toHaveCount(1);

    expect(await rules(page, 'div[role="dialog"]')).toEqual([]);
  });
  /**
   * The screen that matters most, and the one the two clean scans above miss.
   * In the light theme a conversation fails on exactly two structural defects
   * of the sidebar (a grid without rows, a control nested inside a control) —
   * both theme-independent. Asserting the same two here means a colour that
   * only fails in the dark shows up as a third entry rather than as nothing.
   */
  test('a conversation gains no dark-only defect on top of the known two', async ({ page }) => {
    test.setTimeout(150000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    expect((await sendMessage(page, replyPrompt('dark-a11y'))).ok()).toBeTruthy();
    await expect(messagesView(page).getByText(replyText('dark-a11y'))).toBeVisible({
      timeout: 60000,
    });

    expect(await rules(page)).toEqual(['aria-required-children', 'nested-interactive']);
  });
});
