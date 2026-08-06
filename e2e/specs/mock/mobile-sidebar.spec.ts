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
   * Two neighbours pull in opposite directions and both have to keep working:
   *
   *   the panel must cover the drawer, or it opens behind the thing that
   *   launched it;
   *   a dialog opened from INSIDE a panel ("New project") must cover the panel,
   *   or the person is left with a window they cannot reach.
   *
   * This used to be asserted as `dialog z > panel z`, back when the panel had a
   * layer of its own between the drawer and the dialog ladder. Both now share
   * the single modal layer, so comparing the numbers proves nothing — they are
   * equal, and order comes from which was opened later.
   *
   * So the assertion moved to what the person actually sees: at the point each
   * one occupies, is it the thing drawn on top. That is strictly stronger than
   * the old comparison. A written z-index only holds inside its own stacking
   * context, and an ancestor with a transform silently traps it — the old test
   * even said so, noting it passed at z-50 only because an upstream wrapper
   * happened to trap the drawer.
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

    /* Read the drawer BEFORE the second dialog opens. Measured after, this
       passes whatever the panel's layer is: the nested dialog's own scrim
       covers the whole screen, so the drawer is buried either way and the check
       answers a question nobody asked.

       What it catches, measured rather than assumed: the panel dropped below
       the page (z-[-1]) turns it red. What it does NOT catch is a merely small
       positive number — z-10 keeps passing, and correctly so. The panel is
       portalled outside Root.tsx's `relative z-0` wrapper, which traps the
       whole app including the drawer's 110 in one local context, so any
       non-negative layer already sits above it. The comparison this replaced
       (`panel z > drawer z`) read as if the numbers decided that. They do
       not. */
    const overDrawer = await page.evaluate(() => {
      const previous = document.body.style.pointerEvents;
      document.body.style.pointerEvents = 'auto';
      try {
        const el = document.querySelector('div.fixed.left-0.top-0');
        if (!el) return { found: false, stillOnTop: false };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { found: true, stillOnTop: !!top && el.contains(top) };
      } finally {
        document.body.style.pointerEvents = previous;
      }
    });
    expect(overDrawer.found, 'drawer not found').toBe(true);
    expect(overDrawer, 'the panel must cover the drawer it was opened from').toMatchObject({
      stillOnTop: false,
    });

    // Now a dialog from inside the panel: it has to land above the panel.
    await page.getByRole('button', { name: 'New project' }).first().click();
    await expect(page.locator('#project-name')).toBeVisible();

    const painted = await page.evaluate(() => {
      /* Lifted on the body alone. Radix switches pointer events off there while
         a modal is open, so an untouched hit test reports what would catch the
         click rather than what is drawn on top — and a buried dialog still
         catches clicks, blind. A blanket rule over every element is wrong the
         other way: it revives the deliberately click-through toast viewport,
         which then reads as covering everything. */
      const previous = document.body.style.pointerEvents;
      document.body.style.pointerEvents = 'auto';
      const name = (el: Element | null) =>
        el
          ? `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join('.')}`
          : 'nothing';
      try {
        const dialog = document.querySelector('[role="dialog"][data-state="open"]');
        const box = dialog?.getBoundingClientRect();
        const over = box
          ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          : null;
        return {
          found: !!dialog,
          onTop: !!(dialog && over && dialog.contains(over)),
          /* Named so a failure says who covered it, not just that something did. */
          coveredBy: !over || dialog?.contains(over) ? '' : name(over),
        };
      } finally {
        document.body.style.pointerEvents = previous;
      }
    });

    expect(painted.found, 'dialog not found').toBe(true);
    expect(painted, 'a dialog opened inside a panel must be drawn above it').toMatchObject({
      onTop: true,
      coveredBy: '',
    });
  });
});
