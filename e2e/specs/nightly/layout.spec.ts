import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Runs on every nightly project, so each assertion is made once per viewport,
 * theme and locale. Locators here must not depend on English: the same file
 * runs against the Russian build.
 */
const composer = (page: Page) => page.locator('form textarea').first();

/** Wider than the window means a sideways scrollbar — the classic symptom of
 * longer translated labels or a fixed width that survives a narrow viewport. */
const overflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

test.describe('layout', () => {
  test('the chat screen is usable and does not scroll sideways', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(composer(page)).toBeVisible();

    await composer(page).click();
    await composer(page).fill('typed at this viewport');
    await expect(composer(page)).toHaveValue('typed at this viewport');

    const { scrollWidth, innerWidth } = await overflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test('the file library opens and does not scroll sideways', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(composer(page)).toBeVisible();

    /* Below 768px the sidebar is a closed drawer, so the entry has to be
     * revealed before it can be clicked. By test id, not by name: the labels
     * are translated and this file also runs against the Russian build. */
    const opener = page.getByTestId('open-sidebar-button');
    if (await opener.isVisible().catch(() => false)) {
      await opener.click();
    }
    await page.getByTestId('sidebar-link-files').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toHaveCount(1);

    const { scrollWidth, innerWidth } = await overflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });
});
