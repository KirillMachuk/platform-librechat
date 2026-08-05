import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Runs on every nightly project, so each assertion is made once per viewport,
 * theme and locale. Locators here must not depend on English: the same file
 * runs against the Russian build.
 */
const composer = (page: Page) => page.locator('form textarea').first();

/**
 * Wider than its own box means a sideways scrollbar — the classic symptom of
 * longer translated labels or a fixed width that survives a narrow viewport.
 *
 * Measured per container, not on the document alone, and that is the whole
 * point. `main` carries `overflow-x: auto`, so content wider than the chat
 * column scrolls **inside** it and never reaches
 * `document.documentElement.scrollWidth`. Injecting a 5000px element proves it:
 * into `<body>` the document reports 5000, into `<main>` it still reports 1280
 * while `main.scrollWidth` reports 5000. An earlier version of this check
 * measured only the document, and the mutation that "proved" it worked put the
 * wide element in `<body>` — the one place it happened to be visible.
 *
 * `aside` is deliberately not measured: it is `overflow: hidden`, so a wide
 * label there is clipped rather than scrolled and its `scrollWidth` never grows
 * either. An assertion about it could not fail, which is worse than none.
 */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      mainScrollWidth: main?.scrollWidth ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
    };
  });

const expectNoSidewaysScroll = (measured: Awaited<ReturnType<typeof overflow>>) => {
  expect(measured.docScrollWidth).toBeLessThanOrEqual(measured.innerWidth + 1);
  /* A `main` of zero width would make the line below pass for free. */
  expect(measured.mainClientWidth).toBeGreaterThan(0);
  expect(measured.mainScrollWidth).toBeLessThanOrEqual(measured.mainClientWidth + 1);
};

test.describe('layout', () => {
  test('the chat screen is usable and does not scroll sideways', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await expect(composer(page)).toBeVisible();

    await composer(page).click();
    await composer(page).fill('typed at this viewport');
    await expect(composer(page)).toHaveValue('typed at this viewport');

    expectNoSidewaysScroll(await overflow(page));
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

    expectNoSidewaysScroll(await overflow(page));
  });
});
