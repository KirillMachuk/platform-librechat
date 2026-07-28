import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  mockReply,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

test.describe('endpoint switching', () => {
  for (const endpoint of MOCK_ENDPOINTS) {
    test(`"${endpoint.label}" returns a streamed response`, async ({ page }) => {
      test.setTimeout(60000);
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

      await selectMockEndpoint(page, endpoint);

      const response = await sendMessage(page, `hello ${endpoint.model}`);
      expect(response.ok()).toBeTruthy();
      await expect(mockReply(page)).toBeVisible();
    });
  }
});

test.describe('model selector tabs', () => {
  /**
   * The Agents/LLM tabs use roving tabindex, so arrow keys are the only route to
   * the unselected tab. They live inside an Ariakit combobox list, and that
   * composite ignores horizontal keys while its virtual focus is in the search
   * field — which is why the arrows have to be handled on the tabs themselves.
   * jsdom has none of that machinery, so only a browser can prove the keys
   * actually arrive and that the menu survives them.
   */
  test('switch with arrow keys without closing the menu', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

    await page.getByRole('button', { name: 'Select a model' }).first().click();
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(2, { timeout: 10000 });

    const selected = () =>
      tabs.evaluateAll((els) => els.map((el) => el.getAttribute('aria-selected')));
    const before = await selected();

    // Tab reaches the selected tab; the arrow must then reach its sibling.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('tab');
    await page.keyboard.press('ArrowRight');

    await expect
      .poll(selected, { message: 'ArrowRight must move the selection' })
      .not.toEqual(before);
    await expect(tabs.first()).toBeVisible();
  });
});
