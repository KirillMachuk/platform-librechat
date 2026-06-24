import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Narrow viewports render UnifiedSidebar's small-screen branch: a fixed overlay
 * drawer (not the desktop fixed-width column). The drawer is always mounted; its
 * open/closed state is conveyed by `inert` (a11y) and a translate transform, and
 * a full-screen backdrop sits behind it. This exercises that branch end-to-end:
 * opening from the header and the three ways to close it (close button, backdrop,
 * Escape), asserting the inert + focusability contract each time.
 */
const MOBILE_VIEWPORT = { width: 414, height: 896 };

const expectOpen = async (drawer: Locator, overlayButton: Locator) => {
  await expect(drawer).not.toHaveAttribute('inert');
  await expect(drawer).toBeInViewport();
  await expect(overlayButton).toHaveAttribute('tabindex', '0');
};

const expectClosed = async (drawer: Locator, overlayButton: Locator) => {
  await expect(drawer).toHaveAttribute('inert', '');
  await expect(drawer).not.toBeInViewport();
  await expect(overlayButton).toHaveAttribute('tabindex', '-1');
};

const openDrawer = async (page: Page, drawer: Locator, overlayButton: Locator) => {
  await page.getByTestId('open-sidebar-button').click();
  await expectOpen(drawer, overlayButton);
};

test.describe('mobile sidebar drawer', () => {
  test('opens from the header and closes via the close button, backdrop, and Escape', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/c/new', { timeout: 15000 });

    // The drawer panel is the off-canvas container that holds the close button;
    // the backdrop is the only role="presentation" element on this route.
    const drawer = page
      .locator('div.fixed.left-0.top-0')
      .filter({ has: page.getByTestId('close-sidebar-button') });
    const overlayButton = page.locator('div[role="presentation"]').getByRole('button', {
      name: 'Close sidebar',
    });

    await expect(page.getByTestId('open-sidebar-button')).toBeVisible({ timeout: 20000 });
    await expect(drawer).toHaveCount(1);

    // On a narrow viewport the drawer boots collapsed: off-screen, inert, with a
    // non-focusable backdrop.
    await expectClosed(drawer, overlayButton);

    // Close with the in-drawer close button.
    await openDrawer(page, drawer, overlayButton);
    await page.getByTestId('close-sidebar-button').click();
    await expectClosed(drawer, overlayButton);

    // Close by tapping the backdrop, in the region the drawer does not cover.
    await openDrawer(page, drawer, overlayButton);
    await overlayButton.click({ position: { x: MOBILE_VIEWPORT.width - 24, y: 440 } });
    await expectClosed(drawer, overlayButton);

    // Close with the Escape key (handler is only active while open on mobile).
    await openDrawer(page, drawer, overlayButton);
    await page.keyboard.press('Escape');
    await expectClosed(drawer, overlayButton);
  });
});
