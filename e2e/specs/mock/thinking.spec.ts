import { test, expect } from '@playwright/test';

/**
 * Cards К4: the reasoning block end to end on the mock stand. The fake model
 * streams REAL reasoning chunks (additional_kwargs.reasoning_content) through
 * the live agents pipeline — no fabricated SSE frames — so this covers the
 * whole chain: chunk → on_reasoning_delta → THINK part → ThinkingReasoning.
 * While thinking the block is forced open and reveals clamped sentence rows
 * under the shimmering «Thinking…» header; when the reply lands it folds into
 * the measured «Thought for Ns» line; reopened it shows the FULL text.
 */

test.describe('thinking block (cards К4)', () => {
  test('streams sentence rows, folds into the duration line, reopens onto full text', async ({
    page,
  }) => {
    await page.goto('/c/new', { waitUntil: 'domcontentloaded' });
    const textarea = page.getByTestId('text-input');
    await textarea.waitFor({ state: 'visible' });
    await textarea.fill('E2E_SLOW_THINK_REPLY:k4');
    await textarea.press('Enter');

    const block = page.getByTestId('thinking-block');
    await expect(block).toBeVisible({ timeout: 30_000 });
    const header = block.getByRole('button');

    /* While thinking: the platform shimmer header, forced open, sentence rows. */
    await expect(page.getByTestId('think-sentence').first()).toBeVisible({ timeout: 15_000 });
    await expect(header).toHaveText(/Thinking…|Думаю…/);
    await expect(header).toHaveAttribute('aria-expanded', 'true');

    /* The reply lands → the block folds into the measured duration line. */
    await expect(
      page.getByTestId('messages-view').getByText('E2E slow think reply k4'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(header).toHaveText(/Thought for \d+s|Думал \d+ с/, { timeout: 15_000 });
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    /* Playwright's visibility does not understand ancestor clipping — the
     * folded state is asserted through its real contract: the content group
     * is aria-hidden and the whole block shrinks to the summary line. */
    const group = block.locator('[role="group"]');
    await expect(group).toHaveAttribute('aria-hidden', 'true');
    await expect
      .poll(async () => (await block.boundingBox())?.height ?? 0, { timeout: 5_000 })
      .toBeLessThan(40);

    /* Reopen: the FULL text, not the clamped preview rows. */
    await header.click();
    await expect(group).not.toHaveAttribute('aria-hidden', 'true');
    const full = page.getByTestId('think-full');
    await expect(full).toContainText('Мысль 1');
    await expect(full).toContainText('Мысль 6');
    await expect(page.getByTestId('think-sentence')).toHaveCount(0);
    await expect
      .poll(async () => (await block.boundingBox())?.height ?? 0, { timeout: 5_000 })
      .toBeGreaterThan(100);
  });
});
