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
import { attachFixture, fileFixture, openFilesPanel } from '../mock/files.helpers';

/**
 * Dark theme. The canon calls out contrast in the dark as its own risk — light
 * and dark do not fail in the same places, and the PR gate only ever sees light.
 *
 * Every scan here states its own starting state and matches its light-theme
 * sibling in `e2e/specs/mock/a11y.spec.ts`. Two of them did not, and both were
 * green for it: the new-chat scan kept the sidebar in while the light one
 * excludes it, so it passed or failed depending on whether an earlier test had
 * created a conversation; and the file library scan ran against an empty table,
 * where the row-level defects it should have caught cannot exist.
 */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/* The sidebar's two structural defects are theme-independent and owned by the
 * conversation test at the bottom of this file. Left in every other scan they
 * make the result depend on how many conversations happen to exist. */
const SIDEBAR = 'aside';

const rules = async (page: Page, within?: string, excluding?: string) => {
  let builder = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  if (within) {
    builder = builder.include(within);
  }
  if (excluding) {
    builder = builder.exclude(excluding);
  }
  const results = await builder.analyze();
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

    expect(await rules(page, undefined, SIDEBAR)).toEqual([]);
  });

  /**
   * With a file in it, like its light-theme sibling. An empty table has no rows,
   * and the row-level defects — a row that is itself a control with a control
   * inside it, and a table declaring a role whose required children it does not
   * provide — only exist once there is a row to have them. Scanning an empty
   * library was how this test came back clean and read as "the dark theme is
   * better here", when it had simply looked at less.
   *
   * What the dark theme genuinely does better is the contrast: the column
   * headers that fail at 4.34:1 in the light palette do not appear here.
   */
  test('the file library in the dark shows the structural defects but not the contrast one', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await attachFixture(page, fileFixture('notes.md'));
    await openFilesPanel(page);

    expect(await rules(page, 'div[role="dialog"]')).toEqual([
      'aria-required-children',
      'nested-interactive',
    ]);
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
