import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

/**
 * Bookmarks span two surfaces that were wired up at different times: the chat header files a
 * conversation under a bookmark, the sidebar browses by it. Both hang off one switch that ships
 * off, so every assertion here has to state which side of that switch it is on.
 */

const headerBookmark = (page: Page) => page.getByTestId('bookmark-menu');
const sidebarBookmark = (page: Page) => page.getByTestId('bookmark-nav');
const bookmarksSwitch = (page: Page) => page.getByTestId('showBookmarksMenu');
const conversationNamed = (page: Page, title: string) =>
  page.getByTestId('convo-item').filter({ hasText: title });
const firstConversation = (page: Page) => page.getByTestId('convo-item').first();

function uniqueLabel(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Entries that exist in exactly one of the two bookmark menus, so closing can be asserted. */
const HEADER_MENU_ITEM = 'New Bookmark';
const SIDEBAR_MENU_ITEM = 'Clear all';

async function closeMenu(page: Page, ownItem: string) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: ownItem })).toHaveCount(0);
}

async function openChatSettings(page: Page) {
  await page.getByTestId('nav-user').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Chat' }).click();
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeHidden();
}

/** The switch is a per-account setting, so a test that flips it must flip it back. */
async function setBookmarksMenu(page: Page, enabled: boolean) {
  await openChatSettings(page);
  const target = String(enabled);
  if ((await bookmarksSwitch(page).getAttribute('aria-checked')) !== target) {
    await bookmarksSwitch(page).click();
  }
  await expect(bookmarksSwitch(page)).toHaveAttribute('aria-checked', target);
  await closeSettings(page);
  /** Long enough for the debounced preference upload to leave. */
  await page.waitForTimeout(2000);
}

async function openMockChat(page: Page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
  /** The model selector only answers clicks once the chat view is live. */
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId('model-selector-trigger').first()).toBeVisible({ timeout: 20000 });
  await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
}

async function sendAndExpectReply(page: Page, label: string) {
  const prompt = replyPrompt(label);
  const response = await sendMessage(page, prompt);
  expect(response.ok()).toBeTruthy();
  await expect(messagesView(page).getByText(prompt)).toBeVisible({ timeout: 30000 });
  await expect(messagesView(page).getByText(replyText(label))).toBeVisible({ timeout: 30000 });
}

async function renameConversation(page: Page, conversation: Locator, title: string) {
  await conversation.hover();
  await conversation.getByRole('button', { name: 'Conversation Menu Options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const titleInput = conversation.getByRole('textbox', { name: 'New Conversation Title' });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await conversation.getByRole('button', { name: 'Save' }).click();
  await expect(conversation).toContainText(title);
}

/** Creates a saved conversation under `title` and leaves it open. */
async function createNamedConversation(page: Page, title: string) {
  await openMockChat(page);
  await sendAndExpectReply(page, uniqueLabel('bookmarkable'));
  await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/, { timeout: 30000 });
  await renameConversation(page, firstConversation(page), title);
}

test.describe('bookmarks', () => {
  test('stay out of sight entirely while the switch is off', async ({ page }) => {
    test.setTimeout(120000);

    await createNamedConversation(page, uniqueLabel('Без закладок'));

    /* A saved, open conversation is the one state in which both controls would render, so
     * their absence here is the switch doing its job — not an empty page. */
    await expect(firstConversation(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    await expect(headerBookmark(page)).toHaveCount(0);
    await expect(sidebarBookmark(page)).toHaveCount(0);
  });

  test('file a chat from the header, find it under that bookmark in the sidebar, take it back out', async ({
    page,
  }) => {
    test.setTimeout(240000);

    const plainTitle = uniqueLabel('Без закладки');
    const taggedTitle = uniqueLabel('С закладкой');
    const bookmark = uniqueLabel('bookmark');

    await createNamedConversation(page, plainTitle);
    await createNamedConversation(page, taggedTitle);

    /* Flipped only now: the switch reaches the account through a debounced upload, and a
     * page load in between could race it back to off. */
    await setBookmarksMenu(page, true);

    try {
      /* File the open conversation under a brand-new bookmark. The dialog ticks
       * "add to conversation" for us because it was opened from a saved chat. */
      await expect(headerBookmark(page)).toBeVisible({ timeout: 20000 });
      await headerBookmark(page).click();
      await page.getByRole('menuitem', { name: 'New Bookmark' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Title', { exact: true }).fill(bookmark);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(headerBookmark(page)).toHaveAttribute('aria-pressed', 'true');

      /* The header menu stays open behind the dialog; both menus list the same bookmarks, so
       * one has to be shut before the other is opened. */
      await closeMenu(page, HEADER_MENU_ITEM);

      /* The sidebar offers the bookmark and narrows the chat list to it. */
      await sidebarBookmark(page).click();
      const sidebarEntry = page.getByRole('menuitemcheckbox', { name: bookmark });
      await expect(sidebarEntry).toBeVisible();
      await sidebarEntry.click();
      await expect(sidebarEntry).toHaveAttribute('aria-checked', 'true');
      await closeMenu(page, SIDEBAR_MENU_ITEM);

      await expect(conversationNamed(page, taggedTitle)).toHaveCount(1, { timeout: 20000 });
      await expect(conversationNamed(page, plainTitle)).toHaveCount(0);
      await expect(sidebarBookmark(page)).toHaveAttribute('aria-pressed', 'true');

      /* Taking the chat out of the bookmark empties the filtered list. */
      await headerBookmark(page).click();
      const headerEntry = page.getByRole('menuitemcheckbox', { name: bookmark });
      await expect(headerEntry).toBeVisible();
      await headerEntry.click();
      await expect(headerBookmark(page)).toHaveAttribute('aria-pressed', 'false');
      await closeMenu(page, HEADER_MENU_ITEM);

      await expect(conversationNamed(page, taggedTitle)).toHaveCount(0, { timeout: 20000 });
    } finally {
      await setBookmarksMenu(page, false);
    }
  });
});
