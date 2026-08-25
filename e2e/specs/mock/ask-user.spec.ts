import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const MCP_SERVER_TITLE = 'E2E Memory';

/**
 * Interactive cards К3: the `ask_user` tool end to end on the mock stand.
 * The fake model answers the marker prompt with an ask_user tool call
 * (asserting the tool WAS advertised — i.e. initializeAgent registered it),
 * the client renders the questions card, the user answers through it, and
 * the answers land as ONE summary message rendered as a content-preserving
 * chip. The follow-up model turn then runs normally.
 */

const ASK_PROMPT = 'E2E: спроси меня';

/** Select the mock MCP server from the composer's Tools menu (same flow as
 *  mcp-ephemeral.spec.ts) — makes the run tool-bearing. */
async function selectEphemeralMCP(page: Page) {
  await page.getByRole('button', { name: 'MCP Servers', exact: true }).click();
  const serverItem = page.getByRole('menuitemcheckbox', { name: new RegExp(MCP_SERVER_TITLE) });
  await expect(serverItem).toBeVisible();
  await serverItem.click();
  await expect(serverItem).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
}

test.describe('ask_user questions card', () => {
  test('answers flow: card → selections → summary chip → static card', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('PIN_MCP_', 'true');
    });
    await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
    const textarea = page.getByTestId('text-input');
    await textarea.waitFor({ state: 'visible' });

    /* ask_user joins only tool-bearing runs (the repo pins that tool-less
     * runs stay tool-less — chat-only Anthropic reasoning must keep its
     * thinking). Arm the mock MCP server so this run is an ephemeral agent
     * with a tool, like every real «Авто» chat (the mcp-ephemeral suite's
     * own precondition pattern). */
    await selectEphemeralMCP(page);

    await textarea.fill(ASK_PROMPT);
    await textarea.press('Enter');

    const card = page.getByTestId('approval-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText('Какой формат отчёта?')).toBeVisible();

    /* The model must have been told the tool exists — the fake model replies
     * with an explicit failure text when ask_user was not advertised. */
    await expect(page.getByText('E2E ask_user unavailable', { exact: false })).toHaveCount(0);

    await card.getByRole('radio', { name: /Полный отчёт/ }).click();
    await card.getByRole('radio', { name: /Квартал/ }).click();

    const continueBtn = card.getByRole('button', { name: /Продолжить|Continue/ });
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    /* The ONE summary message renders as the answers CHIP (review K3: the
     * raw-text assertion was green while the chip was dead - the marker
     * matched the plain bubble). Assert the chip element itself, its
     * localized en header, the pairs INSIDE it, and that the raw marker
     * line is NOT on screen (the chip drops it). */
    const chip = page.getByTestId('answers-chip');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip.getByText('Answers to the assistant', { exact: false })).toBeVisible();
    await expect(chip.getByText('Какой формат отчёта? — Полный отчёт')).toBeVisible();
    await expect(chip.getByText('За какой период? — Квартал')).toBeVisible();
    await expect(page.getByText('Ответы на вопросы:', { exact: false })).toHaveCount(0);

    /* The card goes static: no Continue button anywhere anymore. */
    await expect(card.getByRole('button', { name: /Продолжить|Continue/ })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
