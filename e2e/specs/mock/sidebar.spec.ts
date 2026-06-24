import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Size of the virtualized chat list grid vs. its measured container. */
const sizes = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('aside .ReactVirtualized__Grid');
    const wrap = grid?.parentElement ?? null;
    const gridRect = grid?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    return {
      grid: gridRect ? gridRect.width : -1,
      wrap: wrapRect ? wrapRect.width : -1,
      gridH: gridRect ? gridRect.height : -1,
      wrapH: wrapRect ? wrapRect.height : -1,
    };
  });

/**
 * Polls until the grid matches its container AND the size has stopped changing
 * between samples — the sidebar expand/collapse animation runs for 300ms, and a
 * tracking-only check can match mid-animation on slow CI machines.
 */
const settledSizes = async (page: Page) => {
  let prev = await sizes(page);
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(350);
    const next = await sizes(page);
    const tracked =
      next.wrap > 0 &&
      next.wrapH > 0 &&
      Math.abs(next.grid - next.wrap) <= 1 &&
      Math.abs(next.gridH - next.wrapH) <= 1;
    const stable = Math.abs(next.grid - prev.grid) <= 1 && Math.abs(next.gridH - prev.gridH) <= 1;
    if (tracked && stable) {
      return next;
    }
    prev = next;
  }
  throw new Error(`Sidebar chat list never settled: ${JSON.stringify(prev)}`);
};

test.describe('sidebar chat list', () => {
  test('chat list width tracks the sidebar through collapse and viewport cycles', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.goto('/c/new', { timeout: 10000 });
    await expect(page.locator('aside .ReactVirtualized__Grid').first()).toBeVisible({
      timeout: 20000,
    });

    // settledSizes asserts the virtualized grid matches its container width.
    const initial = await settledSizes(page);

    // Collapse then re-expand the sidebar; the grid must re-measure back to its
    // container instead of keeping a stale width.
    await page.locator('aside').getByTestId('close-sidebar-button').click();
    await page.locator('aside').getByTestId('open-sidebar-button').click();

    const reopened = await settledSizes(page);
    expect(Math.abs(reopened.grid - initial.grid)).toBeLessThanOrEqual(1);

    // A shorter viewport shrinks the list height while it keeps tracking its container.
    await page.setViewportSize({ width: 1280, height: 540 });
    const shrunken = await settledSizes(page);
    expect(shrunken.gridH).toBeLessThan(initial.gridH);
  });
});
