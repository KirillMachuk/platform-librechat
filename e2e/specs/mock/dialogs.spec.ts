import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { attachFixture, fileFixture } from './files.helpers';
import { NEW_CHAT_PATH, openAccountMenu } from './helpers';

/**
 * What a modal dialog promises a keyboard, ported from
 * `tools/ui_probe_dialogs.js` in the workspace. Five promises, measured on
 * every modal the app opens from the sidebar or the account menu:
 *
 *  1. the page behind stops scrolling while it is open, and scrolls again after
 *  2. focus moves inside it
 *  3. Tab does not walk out of it onto the page behind
 *  4. Escape closes it
 *  5. focus returns to whatever opened it
 *
 * Only modals. The model catalogue is a `role="menu"` popover, and a menu makes
 * different promises — it is not meant to trap focus or lock the page — so
 * asserting these five on it would be pinning the wrong contract. It has a
 * `gap` row of its own instead.
 *
 * The overlay is located by `role=dialog` and counted rather than checked for
 * visibility: the outer wrapper Headless UI renders has no size of its own, so
 * Playwright calls it hidden while the panel inside it is plainly on screen.
 */
type Opened = { overlay: Locator; trigger: Locator };

type DialogReport = {
  lockedBefore: boolean;
  lockedDuring: boolean;
  lockedAfter: boolean;
  focusMovedIn: boolean;
  tabEscapedTo: string | null;
  escapeClosed: boolean;
  focusLandedOn: string;
};

const scrollLocked = (page: Page) =>
  page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    return (
      body.overflow === 'hidden' ||
      root.overflow === 'hidden' ||
      body.position === 'fixed' ||
      document.body.hasAttribute('data-scroll-locked')
    );
  });

/** Where focus actually is, named so a failure says more than "not the trigger". */
const activeElement = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return 'nothing';
    }
    if (active === document.body) {
      return 'BODY';
    }
    const testid = active.getAttribute('data-testid');
    return (
      active.tagName.toLowerCase() +
      (testid ? `{${testid}}` : '') +
      (active.getAttribute('aria-label') ? `[${active.getAttribute('aria-label')}]` : '')
    );
  });

async function walkTheDialog(page: Page, open: () => Promise<Opened>): Promise<DialogReport> {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
  const lockedBefore = await scrollLocked(page);

  const { overlay } = await open();
  const lockedDuring = await scrollLocked(page);
  const focusMovedIn = await overlay
    .evaluate((el) => el.contains(document.activeElement))
    .catch(() => false);

  /* Twenty-five is a whole lap of the biggest dialog here and then some. A trap
   * that holds sends focus round in a circle; one that leaks lands on the page
   * behind, and the element it landed on is worth naming. */
  let tabEscapedTo: string | null = null;
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press('Tab');
    const outside = await overlay
      .evaluate((el) => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          return null;
        }
        return el.contains(active) ? null : active.tagName.toLowerCase();
      })
      .catch(() => null);
    if (outside) {
      tabEscapedTo = outside;
      break;
    }
  }

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0, { timeout: 20000 });

  return {
    lockedBefore,
    lockedDuring,
    lockedAfter: await scrollLocked(page),
    focusMovedIn,
    tabEscapedTo,
    escapeClosed: true,
    focusLandedOn: await activeElement(page),
  };
}

const openSettings = (page: Page) => async (): Promise<Opened> => {
  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
  return { overlay: page.locator('div[role="dialog"]'), trigger: page.getByTestId('nav-user') };
};

const openSidebarPanel = (page: Page, id: string) => async (): Promise<Opened> => {
  const trigger = page.getByTestId(`sidebar-link-${id}`);
  await trigger.click();
  const overlay = page.locator('div[role="dialog"]');
  await expect(overlay).toHaveCount(1, { timeout: 20000 });
  return { overlay, trigger };
};

test.describe('modal dialogs keep their promises', () => {
  test('the projects panel locks the page, holds focus, and hands it back', async ({ page }) => {
    test.setTimeout(120000);
    const report = await walkTheDialog(page, openSidebarPanel(page, 'projects'));

    expect(report).toEqual({
      lockedBefore: false,
      lockedDuring: true,
      lockedAfter: false,
      focusMovedIn: true,
      tabEscapedTo: null,
      escapeClosed: true,
      focusLandedOn: 'button{sidebar-link-projects}[Projects]',
    });
  });

  test('the file library panel keeps the same five promises', async ({ page }) => {
    test.setTimeout(150000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    /* With a file in it: an empty table is a different screen, and the one
     * users meet has rows to tab through. */
    await attachFixture(page, fileFixture('notes.md'));
    const report = await walkTheDialog(page, openSidebarPanel(page, 'files'));

    expect(report).toEqual({
      lockedBefore: false,
      lockedDuring: true,
      lockedAfter: false,
      focusMovedIn: true,
      tabEscapedTo: null,
      escapeClosed: true,
      focusLandedOn: 'button{sidebar-link-files}[Attach Files]',
    });
  });

  /**
   * The settings dialog keeps four of the five. It is opened from a menu item,
   * and closing the menu unmounts the element focus would be restored to — so
   * on Escape focus falls to the document body and the next Tab starts again
   * from the top of the page. A keyboard user loses their place every time they
   * close settings.
   *
   * Two tests, as everywhere else: a `test.fail` for the promise, and an
   * ordinary one pinning exactly where focus goes today. `test.fail` alone is
   * satisfied by any failure, including a broken selector.
   */
  test('the settings dialog hands focus back to the account button', async ({ page }) => {
    test.fail();
    test.setTimeout(120000);
    const report = await walkTheDialog(page, openSettings(page));

    expect(report.focusLandedOn).toBe('button{nav-user}');
  });

  test('the settings dialog keeps the other four, and drops focus to the body', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const report = await walkTheDialog(page, openSettings(page));

    expect(report).toEqual({
      lockedBefore: false,
      lockedDuring: true,
      lockedAfter: false,
      focusMovedIn: true,
      tabEscapedTo: null,
      escapeClosed: true,
      focusLandedOn: 'BODY',
    });
  });
});
