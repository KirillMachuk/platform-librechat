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

const firstConversation = (page: Page) => page.getByTestId('convo-item').first();

function uniqueLabel(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openMockChat(page: Page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
  await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
}

async function sendAndExpectReply(page: Page, label: string) {
  const prompt = replyPrompt(label);
  const reply = replyText(label);
  const response = await sendMessage(page, prompt);
  expect(response.ok()).toBeTruthy();
  /* Generous because the first turn of a cold worker pays for the server
   * warming up; every later one lands in well under a second. */
  await expect(messagesView(page).getByText(prompt)).toBeVisible({ timeout: 30000 });
  await expect(messagesView(page).getByText(reply)).toBeVisible({ timeout: 30000 });
  return { prompt, reply };
}

async function openConversationMenu(conversation: Locator) {
  await conversation.hover();
  await conversation.getByRole('button', { name: 'Conversation Menu Options' }).click();
}

async function renameConversation(page: Page, conversation: Locator, title: string) {
  await openConversationMenu(conversation);
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const titleInput = conversation.getByRole('textbox', { name: 'New Conversation Title' });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await conversation.getByRole('button', { name: 'Save' }).click();
  await expect(conversation).toContainText(title);
}

test.describe('conversation management', () => {
  test('loads a past sidebar conversation with its message history', async ({ page }) => {
    const firstLabel = uniqueLabel('sidebar-history-first');
    const secondLabel = uniqueLabel('sidebar-history-second');

    await openMockChat(page);
    const firstTurn = await sendAndExpectReply(page, firstLabel);
    const secondTurn = await sendAndExpectReply(page, secondLabel);
    const conversationUrl = page.url();

    await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/);
    await expect(firstConversation(page)).toBeVisible();

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await expect(page).toHaveURL(/\/c\/new$/);
    await expect(messagesView(page).getByText(firstTurn.prompt)).toHaveCount(0);
    await expect(messagesView(page).getByText(secondTurn.prompt)).toHaveCount(0);

    await firstConversation(page).click();
    await expect(page).toHaveURL(conversationUrl);
    await expect(messagesView(page).getByText(firstTurn.prompt)).toBeVisible();
    await expect(messagesView(page).getByText(firstTurn.reply)).toBeVisible();
    await expect(messagesView(page).getByText(secondTurn.prompt)).toBeVisible();
    await expect(messagesView(page).getByText(secondTurn.reply)).toBeVisible();
  });

  test('renames a conversation from the sidebar', async ({ page }) => {
    const label = uniqueLabel('sidebar-rename');
    const renamedTitle = `Renamed ${label}`;

    await openMockChat(page);
    await sendAndExpectReply(page, label);

    await renameConversation(page, firstConversation(page), renamedTitle);
    await page.reload({ timeout: 10000 });
    await expect(page.getByTestId('convo-item').filter({ hasText: renamedTitle })).toBeVisible();
  });

  test('deletes a conversation from the sidebar and blocks direct URL access', async ({ page }) => {
    const label = uniqueLabel('sidebar-delete');
    const renamedTitle = `Delete ${label}`;

    await openMockChat(page);
    const turn = await sendAndExpectReply(page, label);
    const conversationUrl = page.url();

    const conversation = firstConversation(page);
    await renameConversation(page, conversation, renamedTitle);
    await openConversationMenu(conversation);
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete chat?' });
    await expect(dialog).toBeVisible();
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' && response.url().includes('/api/convos'),
        { timeout: 30000 },
      ),
      dialog.getByRole('button', { name: 'Delete' }).click(),
    ]);
    expect(deleteResponse.ok()).toBeTruthy();

    await expect(page).toHaveURL(/\/c\/new$/);
    await expect(page.getByTestId('convo-item').filter({ hasText: renamedTitle })).toHaveCount(0);

    await page.goto(conversationUrl, { timeout: 10000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    await expect(messagesView(page).getByText(turn.prompt)).toHaveCount(0);
    await expect(messagesView(page).getByText(turn.reply)).toHaveCount(0);
  });
});

test.describe('finding and filing conversations', () => {
  test('archives a conversation out of the sidebar and brings it back', async ({ page }) => {
    test.setTimeout(180000);
    await openMockChat(page);
    await sendAndExpectReply(page, uniqueLabel('archivable'));

    const title = uniqueLabel('Договор на архив');
    await renameConversation(page, firstConversation(page), title);
    const sidebarEntry = page.getByTestId('convo-item').filter({ hasText: title });
    await expect(sidebarEntry).toHaveCount(1);

    await openConversationMenu(firstConversation(page));
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(sidebarEntry).toHaveCount(0, { timeout: 30000 });

    await openArchivedChats(page);
    const archivedRow = page.getByRole('dialog').getByText(title, { exact: false }).first();
    await expect(archivedRow).toBeVisible({ timeout: 30000 });

    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Unarchive/i })
      .first()
      .click();
    await expect(page.getByRole('dialog').getByText(title, { exact: false })).toHaveCount(0, {
      timeout: 30000,
    });

    await page.keyboard.press('Escape');
    await expect(sidebarEntry).toHaveCount(1, { timeout: 30000 });
  });
});

async function openArchivedChats(page: Page) {
  await page.getByTestId('nav-user').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Archived chats', exact: true }).click();
}
