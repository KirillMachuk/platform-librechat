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
 * Bookmarks are one feature with three surfaces: the chat header files a conversation under a
 * bookmark, the sidebar filter browses by it, and the sidebar panel manages the bookmarks
 * themselves. All three hang off one switch that ships off, so every assertion here has to state
 * which side of that switch it is on.
 */

const headerBookmark = (page: Page) => page.getByTestId('bookmark-menu');
const sidebarBookmark = (page: Page) => page.getByTestId('bookmark-nav');
const bookmarksPanelLink = (page: Page) => page.getByTestId('sidebar-link-bookmarks');
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

/** The panel's own content, not the dialog frame — a stable handle while dialogs stack. */
const bookmarksPanel = (page: Page) => page.getByRole('region', { name: 'Bookmarks', exact: true });

/** The create/edit dialog, identified by the form it wraps so a stacked panel cannot match. */
async function fillBookmarkForm(page: Page, name: string) {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('form', { name: 'Bookmark form' }) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

async function openChatSettings(page: Page) {
  /* Opened mid-hydration the account menu appears and then closes under its own re-render, so
   * the click lands on an item that is about to vanish. Wait for the chat view to be live first. */
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({
    timeout: 30000,
  });
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
  /**
   * The switch is a per-account setting: left on, it would fail `settings-sync.spec.ts`, which
   * asserts it starts off. Cleanup lives here rather than in each test's `finally` so that a real
   * failure is reported as the failure — a `finally` that then trips over a dead page replaces the
   * useful error with a useless one, which is exactly what happened while these were being written.
   */
  test.afterEach(async ({ page }) => {
    if (page.isClosed()) {
      return;
    }
    /* A reload, not an Escape: a panel left open would swallow the click on the account menu. */
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await setBookmarksMenu(page, false);
  });

  /* This one deliberately never touches the switch: it runs on the shipped default, so it fails
   * if that default is ever flipped to on — which is the decision it exists to protect. */
  test('stay out of sight entirely while the switch is off', async ({ page }) => {
    test.setTimeout(120000);

    await createNamedConversation(page, uniqueLabel('Без закладок'));

    /* A saved, open conversation is the one state in which all three surfaces would render,
     * so their absence here is the switch doing its job — not an empty page. The sibling
     * sidebar entries are asserted present for the same reason. */
    await expect(firstConversation(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect(page.getByTestId('sidebar-link-files')).toBeVisible();

    await expect(headerBookmark(page)).toHaveCount(0);
    await expect(sidebarBookmark(page)).toHaveCount(0);
    await expect(bookmarksPanelLink(page)).toHaveCount(0);
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

    /* File the open conversation under a brand-new bookmark. The dialog ticks
     * "add to conversation" for us because it was opened from a saved chat. */
    await expect(headerBookmark(page)).toBeVisible({ timeout: 20000 });
    await headerBookmark(page).click();
    await page.getByRole('menuitem', { name: 'New Bookmark' }).click();
    await fillBookmarkForm(page, bookmark);
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

    /* Switching bookmarks off while a filter is on has to release the filter too — otherwise
     * the chat list stays narrowed with the control that narrowed it gone. */
    await setBookmarksMenu(page, false);
    await expect(sidebarBookmark(page)).toHaveCount(0);
    await expect(headerBookmark(page)).toHaveCount(0);
    await expect(conversationNamed(page, plainTitle)).toHaveCount(1, { timeout: 20000 });
    await setBookmarksMenu(page, true);
    await expect(conversationNamed(page, plainTitle)).toHaveCount(0, { timeout: 20000 });

    /* Taking the chat out of the bookmark empties the filtered list. */
    await headerBookmark(page).click();
    const headerEntry = page.getByRole('menuitemcheckbox', { name: bookmark });
    await expect(headerEntry).toBeVisible();
    await headerEntry.click();
    await expect(headerBookmark(page)).toHaveAttribute('aria-pressed', 'false');
    await closeMenu(page, HEADER_MENU_ITEM);

    await expect(conversationNamed(page, taggedTitle)).toHaveCount(0, { timeout: 20000 });
  });

  /**
   * The panel can rename a bookmark out from under a filter that is using it. Left alone the
   * chat list keeps filtering by a name nothing carries any more, while the menu shows that
   * bookmark unselected — three surfaces telling three different stories.
   */
  test('renaming or deleting a bookmark releases a filter that was using it', async ({ page }) => {
    test.setTimeout(240000);

    const plainTitle = uniqueLabel('Вне закладки');
    const taggedTitle = uniqueLabel('В закладке');
    const before = uniqueLabel('до');
    const after = uniqueLabel('после');

    await createNamedConversation(page, plainTitle);
    await createNamedConversation(page, taggedTitle);
    await setBookmarksMenu(page, true);

    await headerBookmark(page).click();
    await page.getByRole('menuitem', { name: 'New Bookmark' }).click();
    await fillBookmarkForm(page, before);
    await closeMenu(page, HEADER_MENU_ITEM);

    await sidebarBookmark(page).click();
    await page.getByRole('menuitemcheckbox', { name: before }).click();
    await closeMenu(page, SIDEBAR_MENU_ITEM);
    await expect(conversationNamed(page, plainTitle)).toHaveCount(0, { timeout: 20000 });
    await expect(sidebarBookmark(page)).toHaveAttribute('aria-pressed', 'true');

    await bookmarksPanelLink(page).click();
    const panel = bookmarksPanel(page);
    await expect(panel).toBeVisible();
    await panel
      .getByRole('listitem')
      .filter({ hasText: before })
      .getByRole('button', { name: 'Edit Bookmark' })
      .click();
    await fillBookmarkForm(page, after);
    await expect(panel.getByRole('listitem').filter({ hasText: after })).toHaveCount(1, {
      timeout: 20000,
    });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    /* The filter let go, so the chat it had been hiding is listed again. */
    await expect(sidebarBookmark(page)).toHaveAttribute('aria-pressed', 'false', {
      timeout: 20000,
    });
    await expect(conversationNamed(page, plainTitle)).toHaveCount(1, { timeout: 20000 });
    await expect(conversationNamed(page, taggedTitle)).toHaveCount(1);

    /* Same story for deletion: filter by the renamed bookmark, then delete it. */
    await sidebarBookmark(page).click();
    await page.getByRole('menuitemcheckbox', { name: after }).click();
    await closeMenu(page, SIDEBAR_MENU_ITEM);
    await expect(conversationNamed(page, plainTitle)).toHaveCount(0, { timeout: 20000 });

    await bookmarksPanelLink(page).click();
    await expect(panel).toBeVisible();
    await panel
      .getByRole('listitem')
      .filter({ hasText: after })
      .getByRole('button', { name: 'Delete Bookmark' })
      .click();
    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Are you sure you want to delete this bookmark?' });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(panel.getByRole('listitem').filter({ hasText: after })).toHaveCount(0, {
      timeout: 20000,
    });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    await expect(sidebarBookmark(page)).toHaveAttribute('aria-pressed', 'false', {
      timeout: 20000,
    });
    await expect(conversationNamed(page, plainTitle)).toHaveCount(1, { timeout: 20000 });
  });

  test('the sidebar panel creates, renames and deletes a bookmark', async ({ page }) => {
    test.setTimeout(180000);

    /* Deliberately unrelated strings: a renamed label that contained the original would make
     * "the old name is gone" true by substring and prove nothing. */
    const created = uniqueLabel('панель');
    const renamed = uniqueLabel('переименована');

    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({
      timeout: 30000,
    });
    await setBookmarksMenu(page, true);

    await bookmarksPanelLink(page).click();
    const panel = bookmarksPanel(page);
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'New Bookmark' }).click();
    await fillBookmarkForm(page, created);
    const row = panel.getByRole('listitem').filter({ hasText: created });
    await expect(row).toHaveCount(1, { timeout: 20000 });

    await row.getByRole('button', { name: 'Edit Bookmark' }).click();
    await fillBookmarkForm(page, renamed);
    await expect(panel.getByRole('listitem').filter({ hasText: renamed })).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(panel.getByRole('listitem').filter({ hasText: created })).toHaveCount(0);

    const renamedRow = panel.getByRole('listitem').filter({ hasText: renamed });
    await renamedRow.getByRole('button', { name: 'Delete Bookmark' }).click();
    const confirm = page
      .getByRole('dialog')
      .filter({ hasText: 'Are you sure you want to delete this bookmark?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(panel.getByRole('listitem').filter({ hasText: renamed })).toHaveCount(0, {
      timeout: 20000,
    });
  });
});
