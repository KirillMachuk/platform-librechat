import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { MOCK_ENDPOINTS, NEW_CHAT_PATH, selectMockEndpoint, sendMessage } from './helpers';
import { getPrimaryE2EUser } from '../../setup/users.mock';

/**
 * Personal settings belong to the employee, not to the browser. These run the whole path
 * in a real browser against a real server: flip a switch here, arrive on a clean device,
 * find it already flipped.
 */

async function openChatSettings(page: Page) {
  await page.getByTestId('nav-user').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Chat' }).click();
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeHidden();
}

const bookmarksSwitch = (page: Page) => page.getByTestId('showBookmarksMenu');

/** A clean browser with no storage and no session — the "new computer" of the story. */
async function signInOnCleanDevice(browser: Browser, baseURL: string) {
  const user = getPrimaryE2EUser();
  const context = await browser.newContext({ storageState: undefined, baseURL });
  const page = await context.newPage();
  await page.goto('/login', { timeout: 15000 });
  await page.getByLabel('Email address', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByTestId('login-button').click();
  await page.waitForURL(/\/c\/new/, { timeout: 20000 });
  return { context, page };
}

test.describe('personal settings follow the account', () => {
  test('a switch flipped here is already flipped on a clean device', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120000);
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL must be configured');
    }

    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openChatSettings(page);
    await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await bookmarksSwitch(page).click();
    await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', 'true');
    /** Long enough for the debounced upload to leave. */
    await page.waitForTimeout(2000);

    const clean = await signInOnCleanDevice(browser, baseURL);
    try {
      await openChatSettings(clean.page);
      await expect(bookmarksSwitch(clean.page)).toHaveAttribute('aria-checked', 'true');
    } finally {
      await clean.context.close();
      await bookmarksSwitch(page).click();
      await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', 'false');
      await page.waitForTimeout(2000);
    }
  });

  /**
   * The complaint that prompted this: the switch is on, but the chat header shows nothing.
   * The icon tags a conversation, so it appears only once there is one to tag.
   */
  test('the bookmarks switch reveals the header icon, but only in a saved chat', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    const icon = page.getByTestId('bookmark-menu');
    await expect(icon).toBeHidden();

    await openChatSettings(page);
    await bookmarksSwitch(page).click();
    await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', 'true');
    await closeSettings(page);

    try {
      /** Still nothing: a chat that does not exist yet has nothing to tag. */
      await expect(icon).toBeHidden();

      await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
      await sendMessage(page, 'save this conversation');
      await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/, { timeout: 30000 });

      /** Now there is a conversation, so the icon is there. */
      await expect(icon).toBeVisible({ timeout: 20000 });
    } finally {
      await openChatSettings(page);
      await bookmarksSwitch(page).click();
      await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', 'false');
      await closeSettings(page);
    }
  });
});
