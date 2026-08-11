import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { NEW_CHAT_PATH } from './helpers';

/**
 * Two answers to one question, side by side.
 *
 * What these pin is the part a person can get wrong: which answer an action
 * belongs to, and whether the comparison is usable on a phone at all. The
 * geometry is measured elsewhere (`tools/p5_multi_probe.js`); jsdom cannot
 * resolve a media query or a hidden column, so this can only live here.
 */
const SECOND_MODEL = 'Mock Provider B';

async function compareTwoAnswers(page: Page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

  await page.getByTestId('add-multi-convo-button').click();
  await page.getByText(SECOND_MODEL, { exact: true }).first().click();

  await page.getByTestId('text-input').fill('Compare two answers');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sibling-content-group')).toBeVisible({ timeout: 45000 });
  /* Wait for both columns rather than a timeout: the second one arrives late. */
  await expect(page.locator('.sibling-content-group > div')).toHaveCount(2, { timeout: 45000 });
}

test.describe('comparing two answers', () => {
  test('every answer carries its own Copy and its own way to keep it', async ({ page }) => {
    test.setTimeout(120000);
    await compareTwoAnswers(page);

    const columns = page.locator('.sibling-content-group > div');
    for (const index of [0, 1]) {
      const column = columns.nth(index);
      await expect(column.getByRole('button', { name: 'Copy this answer' })).toBeVisible();
      await expect(column.getByRole('button', { name: 'Keep this one' })).toBeVisible();
    }

    /* And the turn's own row must not offer a Copy at all: with two answers it
       could not say which one it took. This is the whole point of the split. */
    const turnRow = page.locator('.sibling-content-group').locator('xpath=../..');
    await expect(turnRow.getByRole('button', { name: 'Copy to clipboard' })).toHaveCount(0);
  });

  test('a phone shows one answer at a time and switches between them', async ({ page }) => {
    test.setTimeout(120000);
    /* The comparison is STARTED at a desktop width: the book's mobile header
       law has no Compare button on the phone (hidden below md since 11.08) —
       a phone VIEWS a comparison with the segment, it does not begin one. */
    await compareTwoAnswers(page);
    await page.setViewportSize({ width: 375, height: 812 });
    /* The desktop-expanded sidebar becomes the phone's open drawer after the
       resize and would cover the thread — close it the way a person would. */
    const closeSidebar = page.locator('#close-sidebar-button');
    if (await closeSidebar.isVisible()) {
      await closeSidebar.click();
      /* The drawer slides out by transform and keeps its layout box, so
         toBeHidden never turns true — wait for it to stop covering the
         thread instead. */
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const drawer = document.querySelector('[data-testid="sidebar-drawer"]');
            return drawer ? drawer.getBoundingClientRect().right <= 0 : true;
          }),
        )
        .toBe(true);
    }

    const columns = page.locator('.sibling-content-group > div');
    await expect(columns.nth(0)).toBeVisible();
    await expect(columns.nth(1)).toBeHidden();

    const tabs = page.getByRole('tablist', { name: 'Which answer to show' });
    await expect(tabs).toBeVisible();
    await tabs.getByRole('tab').nth(1).click();

    await expect(columns.nth(0)).toBeHidden();
    await expect(columns.nth(1)).toBeVisible();
  });
});
