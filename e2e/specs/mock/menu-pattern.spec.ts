import { expect, test } from '@playwright/test';
import { NEW_CHAT_PATH, openAccountMenu } from './helpers';

/**
 * A menu is not a dialog, and the difference is not cosmetic.
 *
 * `dialogs.spec.ts` pins what the fork's modals owe a keyboard user: the page
 * behind is locked, focus is trapped inside, Escape closes, focus goes back.
 * A menu owes something else — arrow keys move between its items, Escape
 * closes it, and the page behind is emphatically NOT locked, because a menu is
 * a transient list rather than a room you are shut into. Copying the modal
 * treatment onto a menu is a real and common mistake, and nothing here would
 * have noticed it.
 *
 * The account menu is the one every reader meets, so it is the one pinned.
 */
test.describe('the account menu follows the menu pattern', () => {
  test('it is a menu of menu items, and it does not lock the page like a modal', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    /* Read before opening, so the comparison after is against this run's own
     * page rather than against an assumption about the default. */
    const lockedBefore = await page.evaluate(() => ({
      overflow: getComputedStyle(document.body).overflow,
      pointerEvents: getComputedStyle(document.body).pointerEvents,
    }));

    const menu = await openAccountMenu(page);

    /* The shape. A menu whose children are not menu items reads to a screen
     * reader as a pile of buttons, and the arrow-key contract below stops
     * meaning anything. */
    await expect(menu.getByRole('menuitem').first()).toBeVisible();
    expect(await menu.getByRole('menuitem').count()).toBeGreaterThan(2);

    /* And the difference from a modal, which is the point of this file. A
     * dialog in this fork locks the page behind it — `dialogs.spec.ts` asserts
     * exactly that — and a menu must not. */
    const lockedDuring = await page.evaluate(() => ({
      overflow: getComputedStyle(document.body).overflow,
      pointerEvents: getComputedStyle(document.body).pointerEvents,
      ariaModal: document.querySelector('[role=menu]')?.getAttribute('aria-modal') ?? null,
    }));
    expect(lockedDuring.overflow).toBe(lockedBefore.overflow);
    /* Read and then actually compared. An earlier version measured this and
     * never asserted it, which a review caught: a menu that switched the page's
     * pointer events off would have sailed through. */
    expect(lockedDuring.pointerEvents).toBe(lockedBefore.pointerEvents);
    expect(lockedDuring.ariaModal).toBeNull();
  });

  test('arrow keys walk its items and Escape gives focus back', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const menu = await openAccountMenu(page);
    const inMenu = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        return {
          role: active?.getAttribute('role') ?? null,
          name: (active?.getAttribute('aria-label') || (active as HTMLElement)?.innerText || '')
            .trim()
            .slice(0, 40),
        };
      });

    /* Polled, not snapshotted. `press` waits for the event to be dispatched, not
     * for the roving-focus implementation to commit it on the next frame, so a
     * single read right after the keypress can still see the old element on a
     * slow machine. */
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await inMenu()).role, { timeout: 10000 }).toBe('menuitem');
    const first = await inMenu();

    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await inMenu()).name, { timeout: 10000 }).not.toBe(first.name);
    const second = await inMenu();

    /* Both on an item, and not the same item: either half alone passes on a
     * menu where the arrow keys do nothing at all. */
    expect(first.role).toBe('menuitem');
    expect(second.role).toBe('menuitem');
    expect(second.name).not.toBe(first.name);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    /* Focus back on what opened it. A menu that closes and drops focus to the
     * body sends the next Tab to the top of the page, which is the same defect
     * the settings dialog is pinned for. */
    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null),
        { timeout: 10000 },
      )
      .toBe('nav-user');
  });
});

/**
 * Every item in the account menu wears the same icon size (§2 ladder, `icon-md`).
 * The Help & FAQ item did not: the icon swap in #363 replaced a sized 18px glyph
 * with a bare icon at the set's default 24px, and the one oversized icon pushed
 * its own label sideways (owner, 02.09: «стала странной и большой, сдвигает
 * текст»). Measured as painted, item against item, so a future swap that drops
 * the size class again fails here instead of on the owner's screen.
 */
test.describe('the account menu icons', () => {
  test('are one size, the Help item included', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    const menu = await openAccountMenu(page);
    const sizeOf = async (name: RegExp) => {
      const icon = menu.getByRole('menuitem', { name }).locator('svg').first();
      await expect(icon).toBeVisible();
      const box = await icon.boundingBox();
      if (!box) {
        throw new Error(`no icon box for ${name}`);
      }
      return { width: Math.round(box.width), height: Math.round(box.height) };
    };
    const settings = await sizeOf(/settings/i);
    const help = await sizeOf(/help/i);
    expect(help).toEqual(settings);
    expect(help.width).toBeLessThanOrEqual(20);
  });
});
