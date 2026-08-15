import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  openAccountMenu,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from './helpers';
import { attachFixture, fileFixture, openFilesPanel, openPreview } from './files.helpers';

/**
 * Accessibility of the screens a user lives in.
 *
 * The scans run the WCAG 2.1 A and AA rule sets only. Best-practice rules are
 * left out on purpose: they fire on patterns this app uses deliberately and
 * would turn the suite into noise nobody reads.
 *
 * Each screen that has a known defect gets two tests — one `test.fail` for the
 * clean result we want, and one ordinary test pinning exactly what is wrong
 * today. `test.fail` is satisfied by any failure, including a broken helper, so
 * on its own it would quietly stop meaning anything.
 */
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const scan = (page: Page, within?: string, excluding?: string) => {
  let builder = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  if (within) {
    builder = builder.include(within);
  }
  if (excluding) {
    builder = builder.exclude(excluding);
  }
  return builder.analyze();
};

/* The sidebar has two defects of its own, owned by the conversation tests
 * below. Leaving it in every other scan makes those tests depend on how many
 * conversations happen to exist when they run — which is how three of them
 * passed only because they ran before anything created one. */
const SIDEBAR = 'aside';

/** What failed, naming the element rather than dumping the whole rule object. */
const describeViolations = (results: Awaited<ReturnType<typeof scan>>) =>
  results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    where: violation.nodes.map((node) => node.target.join(' ')),
  }));

const FILE_PANEL = 'div[role="dialog"]';

test.describe('accessibility', () => {
  test('the new chat screen has no WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    expect(describeViolations(await scan(page, undefined, SIDEBAR))).toEqual([]);
  });

  /**
   * Two defects appear as soon as the sidebar has a conversation in it:
   * the virtualised chat list declares `role="grid"` without the rows a grid
   * requires, and a conversation row nests an interactive control inside
   * another one. Both are in the sidebar, which is being rebuilt.
   */
  test('a conversation with a reply has no WCAG A/AA violations', async ({ page }) => {
    test.fail();
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    expect((await sendMessage(page, replyPrompt('a11y'))).ok()).toBeTruthy();
    await expect(messagesView(page).getByText(replyText('a11y'))).toBeVisible({ timeout: 60000 });

    expect(describeViolations(await scan(page))).toEqual([]);
  });

  test('a conversation fails only on the two known sidebar defects', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    expect((await sendMessage(page, replyPrompt('a11y-known')))!.ok()).toBeTruthy();
    await expect(messagesView(page).getByText(replyText('a11y-known'))).toBeVisible({
      timeout: 60000,
    });

    expect(
      describeViolations(await scan(page))
        .map((violation) => violation.rule)
        .sort(),
    ).toEqual(['aria-required-children', 'nested-interactive']);
  });

  /**
   * The scan is scoped to the dialog so the sidebar's own defects above do not
   * leak into this result. What is left is the sortable column headers, which
   * render #737373 on #f5f5f5 — 4.34:1 where AA asks for 4.5:1. The colour
   * comes from the shared table component and belongs with the design-token
   * work, so it is recorded here rather than patched.
   */
  test('the file library dialog has no WCAG A/AA violations', async ({ page }) => {
    test.fail();
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    /* With a file in it, not empty: an empty table has no rows, and the row
     * defect below only exists once there is a row to have it. Scanning an
     * empty library was how this test stayed clean. */
    await attachFixture(page, fileFixture('notes.md'));
    await openFilesPanel(page);

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  test('the file library fails on the header contrast and on its own rows', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await attachFixture(page, fileFixture('notes.md'));
    await openFilesPanel(page);

    /* Two defects, and the second was invisible until the table had a row in
     * it: each row carries `role="button"` so the whole row is clickable, and
     * the "attach to chat" button sits inside it — a control inside a control.
     * Same shape as the sidebar row defect, same owner: the redesign. The
     * third, `aria-required-children`, is the table declaring a role whose
     * required children it does not provide — also only visible with a row. */
    expect(
      describeViolations(await scan(page, FILE_PANEL))
        .map((violation) => violation.rule)
        .sort(),
    ).toEqual(['aria-required-children', 'color-contrast', 'nested-interactive']);
  });
});

test.describe('keyboard', () => {
  test('the composer is reachable and operable from the keyboard alone', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await expect(input).toBeVisible();

    /* Tabbing from the top of the document has to arrive at the composer
     * without a mouse. The bound is generous but finite: an unbounded loop
     * would call the hundredth stop "reachable" too. */
    await page.evaluate(() => document.body.focus());
    let reachedAfter = -1;
    for (let press = 1; press <= 40; press++) {
      await page.keyboard.press('Tab');
      if (await input.evaluate((node) => node === document.activeElement)) {
        reachedAfter = press;
        break;
      }
    }
    expect(reachedAfter).toBeGreaterThan(0);

    await page.keyboard.type('typed with the keyboard only');
    await expect(input).toHaveValue('typed with the keyboard only');
  });

  test('closing the file panel hands focus back to what opened it', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    const trigger = page.locator('aside').getByRole('button', { name: 'Attach Files' });
    const panel = await openFilesPanel(page);

    await page.keyboard.press('Escape');
    await expect(panel.getByRole('heading', { name: 'Attach Files' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  const openPanels = (page: Page) => page.locator(FILE_PANEL);

  /**
   * 14.08-3: the preview is the right-side artifacts panel now, not a dialog.
   * The library popover closes itself on row click (a modal lid on top of the
   * panel would be worse than either alone), and Escape closes the panel —
   * dialog parity for the keyboard user. The old 200ms spurious-close guard
   * died with the dialog; there is nothing to wait out.
   */
  test('Escape closes the file preview panel', async ({ page }) => {
    test.setTimeout(120000);
    const fixture = fileFixture('notes.md');
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await attachFixture(page, fixture);
    const preview = await openPreview(page, fixture.name);
    /* The library closed on row click — no dialog remains above the panel. */
    await expect(openPanels(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
  });
});

/**
 * The dialogs a user opens from the sidebar and the account menu. Each is
 * scoped to itself so the sidebar's own two defects, scanned above, do not
 * leak in and mask whatever the dialog has of its own.
 */
test.describe('accessibility of the main dialogs', () => {
  const openSidebarPanel = async (page: Page, id: string) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await page.getByTestId(`sidebar-link-${id}`).click();
    await expect(page.locator(FILE_PANEL)).toHaveCount(1);
  };

  test('the projects panel has no WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(90000);
    await openSidebarPanel(page, 'projects');

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  /**
   * The agents panel labels its grid with `aria-labelledby="category-tab-all"`
   * (AgentGrid.tsx), but that id belongs to a tab CategoryTabs renders from data
   * it has to load first, so the tab itself ends up naming something that is not
   * in the document — a critical `aria-valid-attr-value`.
   *
   * An earlier note here called the violation intermittent. It is not: measured
   * three times, the tab is present and visible when the scan runs and the
   * violation is there every time. What varies is only *when* you scan — before
   * the tabs render the panel is clean, because the element carrying the defect
   * does not exist yet. Both agents tests therefore wait for the tabs, so the
   * "clean" one cannot pass while the defect sits behind it.
   */
  test('the agents panel has no WCAG A/AA violations', async ({ page }) => {
    test.fail();
    test.setTimeout(90000);
    await openSidebarPanel(page, 'agents');
    await expect(page.locator('#category-tab-all')).toBeVisible({ timeout: 30000 });

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  /**
   * Measured three times, same answer every time: the offending element is
   * `#category-tab-all` — the tab itself, which names something that is not in
   * the document. My first reading blamed the grid for pointing at a tab that
   * had not loaded yet, and called the defect intermittent. Both were wrong:
   * the tab is present and visible when the scan runs, and the violation is
   * still there. It is a plain, permanent, critical defect of the tab strip.
   */
  test('the agents panel fails only on its category tab', async ({ page }) => {
    test.setTimeout(90000);
    await openSidebarPanel(page, 'agents');
    await expect(page.locator('#category-tab-all')).toBeVisible({ timeout: 30000 });

    expect(
      describeViolations(await scan(page, FILE_PANEL))
        .map((violation) => violation.rule)
        .sort(),
    ).toEqual(['aria-valid-attr-value']);
  });

  test('the prompts panel has no WCAG A/AA violations', async ({ page }) => {
    test.fail();
    test.setTimeout(90000);
    await openSidebarPanel(page, 'prompts');

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  test('the prompts panel fails only on the nested control', async ({ page }) => {
    test.setTimeout(90000);
    await openSidebarPanel(page, 'prompts');

    expect(
      describeViolations(await scan(page, FILE_PANEL))
        .map((violation) => violation.rule)
        .sort(),
    ).toEqual(['nested-interactive']);
  });

  /**
   * Clean, and measured as such. An earlier pass reported the tab-strip defect
   * here too; re-measured, that was the agents scan's result read into the
   * wrong row, not this dialog's. It is asserted plainly rather than left as a
   * suspicion.
   */
  test('the settings dialog has no WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();

    expect(describeViolations(await scan(page, 'div[role="dialog"]'))).toEqual([]);
  });
});
