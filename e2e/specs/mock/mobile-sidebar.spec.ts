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

  /**
   * The sidebar panel sits on its own layer, deliberately between the drawer
   * (z-110) and the OGDialog layer (overlay 130 / content 140). Both neighbours
   * have to keep working, and they pull in opposite directions:
   *
   *   too low  — the panel hides behind the drawer (only avoided today because
   *              Root.tsx wraps the app in `relative z-0`, which traps z-110 in
   *              a local stacking context; that wrapper is upstream-owned);
   *   too high — a dialog opened from INSIDE a panel (e.g. "New project") renders
   *              underneath the panel that launched it, which is unrecoverable
   *              for the user.
   *
   * Asserting both ends is what makes this test worth having: the first check
   * alone passes for any large z-index, so it would not catch raising the panel
   * above the dialog layer. jsdom computes no stacking, so this can only live here.
   */
  test('a panel layers above the drawer and below a dialog opened inside it', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/c/new', { timeout: 15000 });

    const drawer = page
      .locator('div.fixed.left-0.top-0')
      .filter({ has: page.getByTestId('close-sidebar-button') });

    await expect(page.getByTestId('open-sidebar-button')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('open-sidebar-button').click();
    await expect(drawer).not.toHaveAttribute('inert');

    await drawer.getByRole('button', { name: 'Projects', exact: true }).click();
    // The dialog root is a zero-size `relative` wrapper (its children are fixed), so it never
    // reports as "visible" — anchor on content instead.
    await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible();

    // Open a dialog from inside the panel, then read all three layers off the live DOM.
    await page.getByRole('button', { name: 'New project' }).first().click();
    await expect(page.locator('#project-name')).toBeVisible();

    const layers = await page.evaluate(() => {
      const z = (el: Element | null) => (el ? Number(getComputedStyle(el).zIndex) : NaN);
      return {
        drawer: z(document.querySelector('div.fixed.left-0.top-0')),
        panel: z(document.querySelector('[id^="headlessui-dialog-"]')),
        dialog: z(document.querySelector('[role="dialog"][data-state="open"]')),
      };
    });

    // Compare the layers to each other, never to a literal, so the numbers stay free to move.
    // Note this is deliberately stricter than "it looks right today": at the old z-50 the panel
    // still rendered correctly, but only because Root.tsx's `relative z-0` traps the drawer in a
    // local stacking context. Asserting the raw order removes that dependency on an upstream file.
    expect(layers.drawer, 'drawer layer not found').toBeGreaterThan(0);
    expect(layers.panel, 'the panel must sit above the drawer').toBeGreaterThan(layers.drawer);
    expect(
      layers.dialog,
      'a dialog opened inside a panel must sit above that panel',
    ).toBeGreaterThan(layers.panel);
  });
});
