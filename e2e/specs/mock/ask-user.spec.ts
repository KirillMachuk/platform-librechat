import { test, expect } from '@playwright/test';

/**
 * Interactive cards К3: the `ask_user` tool end to end on the mock stand.
 * The fake model answers the marker prompt with an ask_user tool call
 * (asserting the tool WAS advertised — i.e. initializeAgent registered it),
 * the client renders the questions card, the user answers through it, and
 * the answers land as ONE summary message rendered as a content-preserving
 * chip. The follow-up model turn then runs normally.
 */

const ASK_PROMPT = 'E2E: спроси меня';

test.describe('ask_user questions card', () => {
  test('answers flow: card → selections → summary chip → static card', async ({ page }) => {
    await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
    const textarea = page.getByTestId('text-input');
    await textarea.waitFor({ state: 'visible' });
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

    /* The ONE summary message renders as the answers chip, content preserved. */
    const chip = page.getByText('Ответы на вопросы', { exact: false }).first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Какой формат отчёта? — Полный отчёт', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('За какой период? — Квартал', { exact: false })).toBeVisible();

    /* The card goes static: no Continue button anywhere anymore. */
    await expect(card.getByRole('button', { name: /Продолжить|Continue/ })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
