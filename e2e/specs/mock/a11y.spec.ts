import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
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

const scan = (page: Page, within?: string) => {
  const builder = new AxeBuilder({ page }).withTags(WCAG_21_AA);
  return (within ? builder.include(within) : builder).analyze();
};

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

    expect(describeViolations(await scan(page))).toEqual([]);
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
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openFilesPanel(page);

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  test('the file library fails only on the column-header contrast', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openFilesPanel(page);

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([
      {
        rule: 'color-contrast',
        impact: 'serious',
        where: [
          'th[aria-label="filename column, sortable"] > .md\\:gap-2.gap-1.items-center',
          'th[aria-label="updatedAt column, sortable"] > .md\\:gap-2.gap-1.items-center',
        ],
      },
    ]);
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

  /**
   * Dialogs are addressed through the DOM rather than by role here: the preview
   * marks everything behind it `aria-hidden`, so a role query stops seeing the
   * panel the moment it is no longer the top dialog — which is correct, and is
   * exactly the state these tests need to inspect.
   */
  const openPanels = (page: Page) => page.locator(FILE_PANEL);

  /**
   * The preview swallows any close arriving within `SPURIOUS_CLOSE_MS` (200ms)
   * of opening — Radix emits one spuriously on the first dialog of a page load,
   * and without the guard the dialog would flash open and shut. So the wait is
   * not padding against flakiness: it is the difference between testing what a
   * person does and testing a keypress no human could make. Measured: Escape at
   * 0ms leaves both dialogs open, at 400ms and 1500ms it closes the preview.
   */
  const PAST_THE_SPURIOUS_CLOSE_GUARD = 400;

  test('Escape closes the preview and leaves the panel it came from open', async ({ page }) => {
    test.setTimeout(120000);
    const fixture = fileFixture('notes.md');
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await attachFixture(page, fixture);
    const preview = await openPreview(page, fixture.name);
    await expect(openPanels(page)).toHaveCount(2);
    await page.waitForTimeout(PAST_THE_SPURIOUS_CLOSE_GUARD);

    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    /* Closing the top dialog is not a request to close everything behind it. */
    await expect(openPanels(page)).toHaveCount(1);
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
   * it has to load first. Before the tabs arrive the grid points at an element
   * that is not there — a critical violation, and an intermittent one: whether a
   * scan sees it depends on when it runs. Measured across runs, the critical
   * rule is always present; a second, `nested-interactive`, appears only
   * sometimes, so the twin test below pins the stable one rather than a set that
   * changes between runs.
   */
  test('the agents panel has no WCAG A/AA violations', async ({ page }) => {
    test.fail();
    test.setTimeout(90000);
    await openSidebarPanel(page, 'agents');

    expect(describeViolations(await scan(page, FILE_PANEL))).toEqual([]);
  });

  test('the agents grid labels itself by a tab that may not exist yet', async ({ page }) => {
    test.setTimeout(90000);
    await openSidebarPanel(page, 'agents');

    expect(describeViolations(await scan(page, FILE_PANEL)).map((v) => v.rule)).toContain(
      'aria-valid-attr-value',
    );
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

  test('the settings dialog has no WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await page.getByTestId('nav-user').click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    /* The dialog element is a zero-height positioning wrapper and never counts
     * as visible; its heading is what says the dialog actually opened. */
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();

    expect(describeViolations(await scan(page, 'div[role="dialog"]'))).toEqual([]);
  });
});
