import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { applyRuntimeEnv } from '../../setup/runtimeEnv';

/**
 * The chat cards a conversation produces — shared by the specs that measure them
 * (tap targets) and the ones that scan them (axe). Kept together so a card that
 * changes shape breaks in one place, not two.
 */

export const MCP_SERVER_TITLE = 'E2E Memory';
export const ASK_PROMPT = 'E2E: спроси меня';

/** Four steps against a preview of three, so the «Ещё N» control exists. */
export const PLAN_TEXT = [
  '**План исследования:** Рынок доставки для быстрого питания',
  '',
  '1. Собрать предложения крупнейших агрегаторов',
  '2. Сравнить комиссии и условия 2025–2026',
  '3. Выделить тренды по регионам',
  '4. Сформировать таблицу и рекомендацию',
].join('\n');

/**
 * On a touch profile Enter is a newline, as on a phone; the message goes by the
 * send button — which is also why the shared `sendMessage` (Enter) is not used.
 * Works on a mouse profile too.
 */
export async function sendByButton(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.click();
  await input.fill(text);
  await expect(page.getByTestId('send-button')).toBeEnabled();
  await page.getByTestId('send-button').click();
}

/**
 * A plan card comes from a Deep Research run the fake model cannot stage; the
 * workshop's plan probe seeds one by rewriting the latest reply in the database,
 * and this does the same in the page's own conversation, then reloads so the
 * card renders from history — awaiting approval, with the cancel ✕ and every
 * step on screen.
 */
export async function seedPlanCard(page: Page) {
  applyRuntimeEnv();
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI must be available to seed a plan card');
  }
  const conversationId = page.url().match(/\/c\/([\w-]+)/)?.[1];
  expect(conversationId).toBeTruthy();
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  try {
    const messages = client.db().collection('messages');
    const reply = await messages.findOne(
      { conversationId, isCreatedByUser: false },
      { sort: { createdAt: -1 } },
    );
    expect(reply).toBeTruthy();
    await messages.updateOne(
      { _id: reply!._id },
      { $set: { text: PLAN_TEXT, content: [{ type: 'text', text: PLAN_TEXT }], drKind: 'plan' } },
    );
  } finally {
    await client.close();
  }
  await page.reload({ timeout: 20000 });
  const plan = page.locator('[data-testid="approval-card"][data-variant="plan"]');
  await expect(plan).toBeVisible({ timeout: 30000 });
  return plan;
}

/**
 * Turns the fake MCP server on in the composer's tool menu (the ask_user flow
 * ask-user.spec runs). The page must already be on the chat with the composer
 * visible; drive it at a desktop width — the menu is a desktop control.
 */
export async function enableMcpServer(page: Page, title = MCP_SERVER_TITLE) {
  await page.getByRole('button', { name: 'MCP Servers', exact: true }).click();
  const serverItem = page.getByRole('menuitemcheckbox', { name: new RegExp(title) });
  await expect(serverItem).toBeVisible();
  await serverItem.click();
  await expect(serverItem).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
}

/** Asks the fake tool's questions and returns the open questions card. */
export async function openAskUserCard(page: Page) {
  await sendByButton(page, ASK_PROMPT);
  const card = page.getByTestId('approval-card');
  await expect(card).toBeVisible({ timeout: 30000 });
  return card;
}

/** Answers the two questions so the card folds into its one-line record. */
export async function answerAskUserCard(page: Page) {
  const card = page.getByTestId('approval-card');
  await card.getByRole('radio', { name: /Полный отчёт/ }).click();
  await card.getByRole('radio', { name: /Квартал/ }).click();
  await card.getByRole('button', { name: /Продолжить|Continue/ }).click();
  await expect(page.getByTestId('ask-user-collapsed')).toBeVisible({ timeout: 15000 });
}
