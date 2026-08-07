import { expect, test } from '@playwright/test';
import { MOCK_ENDPOINTS, NEW_CHAT_PATH, selectMockEndpoint, sendMessage } from './helpers';
import { getSecondaryE2EUser } from '../../setup/users.mock';
import { ensureSecondaryUser } from '../../setup/secondaryUser';

const A_PRIVATE_MARKER = 'A-private-conversation-marker';

test.describe('user isolation', () => {
  test('user B cannot see user A conversations', async ({ page, browser, baseURL }) => {
    test.setTimeout(90000);
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL must be configured for mock isolation tests');
    }

    // User A (authenticated via storageState) creates a private conversation.
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    await sendMessage(page, A_PRIVATE_MARKER);
    await expect(page.getByText(A_PRIVATE_MARKER)).toBeVisible();
    await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/);
    const conversationAUrl = page.url();

    // User B in a fresh, unauthenticated context.
    const contextB = await browser.newContext({ storageState: undefined, baseURL });
    const pageB = await contextB.newPage();
    try {
      await ensureSecondaryUser(browser, pageB, getSecondaryE2EUser(), baseURL);

      // (a) Sidebar list does not expose A's conversation.
      await pageB.goto(NEW_CHAT_PATH, { timeout: 10000 });
      await expect(pageB.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      await expect(pageB.getByText(A_PRIVATE_MARKER)).toHaveCount(0);

      // (b) Direct navigation to A's conversation does not reveal its content.
      await pageB.goto(conversationAUrl, { timeout: 10000 });
      await expect(pageB.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      await expect(pageB.getByText(A_PRIVATE_MARKER)).toHaveCount(0);
    } finally {
      await contextB.close();
    }
  });
});
