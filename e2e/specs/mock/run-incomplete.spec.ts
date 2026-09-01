import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { messagesView } from './helpers';

/**
 * 31.08.2026 on the stand: a run in «Авто» searched the library, read three documents and
 * built a 62 KB .pptx, then hit the agent loop's step ceiling. Printed underneath the
 * finished deck: «Не удалось выполнить запрос… Попробуйте ещё раз» — a denial of work the
 * user could see and scroll to, and an invitation to pay for all of it a second time.
 *
 * The server now answers a run that broke AFTER finishing a tool call with the structured
 * `run_incomplete` code instead of a bare sentence, and the client renders its own short
 * notice for it. Both halves have unit tests; this covers the seam between them — the code
 * surviving SSE and reaching the error renderer — because this repo has already shipped a
 * feature whose two halves were each correct while the join between them was dead
 * (the Deep Research pill wired to a branch user messages never reach).
 */

const MCP_SERVER_TITLE = 'E2E Memory';
const TOOL_THEN_ERROR_PROMPT = 'E2E_TOOL_THEN_ERROR:run-incomplete';

/** `ask_user` — the tool this run finishes before it breaks — joins only tool-bearing runs,
 *  so the run needs a tool the way every real «Авто» chat has one (ask-user.spec.ts pattern). */
async function selectEphemeralMCP(page: Page) {
  await page.getByRole('button', { name: 'MCP Servers', exact: true }).click();
  const serverItem = page.getByRole('menuitemcheckbox', { name: new RegExp(MCP_SERVER_TITLE) });
  await expect(serverItem).toBeVisible();
  await serverItem.click();
  await expect(serverItem).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
}

async function runThatBreaksAfterWorking(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('PIN_MCP_', 'true');
  });
  await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
  const textarea = page.getByTestId('text-input');
  await textarea.waitFor({ state: 'visible' });
  await selectEphemeralMCP(page);
  await textarea.fill(TOOL_THEN_ERROR_PROMPT);
  await textarea.press('Enter');
}

test.describe('a run that breaks after doing the work', () => {
  test('says the work is saved and how to carry on, not that the request failed', async ({
    page,
  }) => {
    await runThatBreaksAfterWorking(page);

    /** The finished tool call is on screen — this is the work the notice must not deny. */
    await expect(page.getByTestId('approval-card')).toBeVisible({ timeout: 30_000 });

    const messages = messagesView(page);
    /** Locale-independent, as the thinking suite does it: the stand may run either. */
    await expect(messages).toContainText(/процесс сохранён|the work so far is saved/i, {
      timeout: 30_000,
    });
    await expect(messages).toContainText(/продолжай|continue/i);

    /** The whole point: the blanket failure frame must not appear over surviving work. */
    await expect(messages).not.toContainText(/Не удалось выполнить запрос|Something went wrong/i);
  });
});
