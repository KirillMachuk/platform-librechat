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

/**
 * The fewest distinct controls the Tab walk must land on inside each dialog.
 * A floor, not an exact count: the file library reported 8 on one run and 10 on
 * the next, because files accumulate in the shared database and every extra row
 * is another tab stop. Pinning the exact number would have been pinning how many
 * tests ran before this one.
 *
 * The point of the field is that the walk moved at all — a Tab that does nothing
 * reports a perfect focus trap, which is the failure this guards.
 *
 * Projects is 2 because an empty projects panel now holds exactly two controls:
 * "New project" in the header and the close button. It used to hold a third — a
 * dashed tile repeating the same "New project" underneath it — which P6 removed
 * as a duplicate call to action. Two still tells a moving walk from a stuck one:
 * a Tab that does nothing reports 1.
 */
const MIN_STOPS = { projects: 2, files: 6, settings: 8 };

type DialogReport = {
  lockedBefore: boolean;
  lockedDuring: boolean;
  lockedAfter: boolean;
  focusMovedIn: boolean;
  tabEscapedTo: string | null;
  visitedInside: number;
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
   * behind, and the element it landed on is worth naming.
   *
   * The body counts as OUTSIDE, and that is the whole correction. Treating it as
   * "not out yet" made a dialog with no trap at all indistinguishable from one
   * that holds: focus walks off the last control onto the body, then back to the
   * first, and the trail reads as a circle. Measured on synthetic dialogs — with
   * the trap and without it, this reported the same `null`.
   *
   * `visitedInside` is the other half. An empty escape is only meaningful if the
   * walk moved through the dialog at all; a Tab that does nothing reports a
   * perfect trap. */
  let tabEscapedTo: string | null = null;
  const insideSeen = new Set<string>();
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press('Tab');
    const where = await overlay
      .evaluate((el) => {
        const active = document.activeElement;
        if (!active) {
          return { out: 'nothing', id: '' };
        }
        if (active === document.body) {
          return { out: 'BODY', id: '' };
        }
        if (!el.contains(active)) {
          return { out: active.tagName.toLowerCase(), id: '' };
        }
        /* Stamped, because counting by tag plus accessible name collapses every
         * unlabelled control in the dialog into one entry — the settings dialog
         * reported two stops for a walk of twenty-five. The attribute is local
         * to this measurement and the dialog is closed a moment later. */
        if (!active.hasAttribute('data-tab-stop')) {
          const marker = window as unknown as { __tabStops?: number };
          marker.__tabStops = (marker.__tabStops ?? 0) + 1;
          active.setAttribute('data-tab-stop', String(marker.__tabStops));
        }
        return { out: null, id: active.getAttribute('data-tab-stop') ?? '' };
      })
      .catch(() => ({ out: 'unreadable', id: '' }));
    if (where.out) {
      tabEscapedTo = where.out;
      break;
    }
    insideSeen.add(where.id);
  }

  /* Polled, not asserted here. An earlier version awaited `toHaveCount(0)` and
   * then returned a hardcoded `escapeClosed: true` — so the field the caller
   * asserts could never have been false, and deleting the await would have left
   * a check that reads like one and is not. The value below is measured. */
  await page.keyboard.press('Escape');
  let escapeClosed = false;
  /* Twenty seconds, the same budget the assertion it replaced had. Polling with
   * a tighter one would have traded a tautology for a flake on a slow runner. */
  for (let step = 0; step < 400 && !escapeClosed; step += 1) {
    escapeClosed = (await overlay.count()) === 0;
    if (!escapeClosed) {
      await page.waitForTimeout(50);
    }
  }

  return {
    lockedBefore,
    lockedDuring,
    lockedAfter: await scrollLocked(page),
    focusMovedIn,
    tabEscapedTo,
    visitedInside: insideSeen.size,
    escapeClosed,
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
  if ((await trigger.count()) === 0) {
    await page.getByTestId('sidebar-link-more').click();
  }
  await trigger.click();
  const overlay = page.locator('div[role="dialog"]');
  await expect(overlay).toHaveCount(1, { timeout: 20000 });
  return { overlay, trigger };
};

test.describe('modal dialogs keep their promises', () => {
  test('the projects panel locks the page, holds focus, and hands it back', async ({ page }) => {
    test.setTimeout(120000);
    const { visitedInside, ...report } = await walkTheDialog(
      page,
      openSidebarPanel(page, 'projects'),
    );

    expect(visitedInside).toBeGreaterThanOrEqual(MIN_STOPS.projects);
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
    const { visitedInside, ...report } = await walkTheDialog(page, openSidebarPanel(page, 'files'));

    expect(visitedInside).toBeGreaterThanOrEqual(MIN_STOPS.files);
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
    const { visitedInside, ...report } = await walkTheDialog(page, openSettings(page));

    expect(visitedInside).toBeGreaterThanOrEqual(MIN_STOPS.settings);
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
