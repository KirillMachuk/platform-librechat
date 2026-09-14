import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  fetchJson,
  getAccessToken,
  messagesView,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

/**
 * The owner's 14.09 report, verbatim: «пока ии думает ответ нажимаю Стоп в композере,
 * то ии останавливается, у него нету сообщения — пусто, а под ним остаются иконки
 * Прочитать вслух и другие». Reproduced on the mock stand: an empty agent turn 56px
 * tall with seven buttons, and an assistant row in the database with no text and no
 * content. The contract now: a Stop before the first token leaves the question and
 * nothing else — on screen, after a reload, and in the database.
 */

type E2EMessage = {
  messageId: string;
  parentMessageId?: string | null;
  isCreatedByUser?: boolean;
  text?: string;
};

async function conversationIdFromPage(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/c\/(?!new)[0-9a-fA-F-]{36}$/);
  return new URL(page.url()).pathname.split('/').pop() as string;
}

async function fetchMessages(page: Page, conversationId: string): Promise<E2EMessage[]> {
  const token = await getAccessToken(page);
  return fetchJson<E2EMessage[]>(
    page,
    `/api/messages/${encodeURIComponent(conversationId)}`,
    token,
  );
}

test.describe('Stop before the first token', () => {
  test('leaves the question and no answer turn — on screen, on reload, in the database', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    /* A first exchange, so the stopped one is not also the conversation's birth. */
    await sendMessage(page, 'E2E_REPLY:warm');
    await expect(messagesView(page).getByText('E2E reply warm')).toBeVisible({ timeout: 30000 });
    const conversationId = await conversationIdFromPage(page);

    /* The model stays silent for 8 s; Stop lands well inside that window. */
    await sendMessage(page, 'E2E_SILENT_REPLY:stop');
    const stop = page.getByRole('button', { name: 'Stop generating' });
    await expect(stop).toBeVisible({ timeout: 15000 });
    const [abortResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/agents/chat/abort'), { timeout: 30000 }),
      stop.click(),
    ]);
    expect(abortResponse.ok()).toBeTruthy();
    await expect(stop).toBeHidden({ timeout: 30000 });

    const view = messagesView(page);
    const expectQuestionAlone = async () => {
      await expect(view.getByText('E2E_SILENT_REPLY:stop')).toBeVisible({ timeout: 15000 });
      /* One agent turn in the chat: the warm-up reply. The stopped one never began. */
      await expect(view.locator('.agent-turn')).toHaveCount(1);
      await expect(view.getByText('E2E silent reply stop')).toHaveCount(0);
      await expect(view.getByTestId('waiting-label')).toHaveCount(0);
    };
    await expectQuestionAlone();

    /* The database agrees: the question is the leaf, nothing hangs off it. */
    const messages = await fetchMessages(page, conversationId);
    const question = messages.find((m) => m.text === 'E2E_SILENT_REPLY:stop');
    expect(question?.isCreatedByUser).toBe(true);
    expect(messages.filter((m) => m.parentMessageId === question?.messageId)).toEqual([]);
    expect(messages.filter((m) => m.isCreatedByUser === false)).toHaveLength(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectQuestionAlone();

    /* The composer is free: the next question goes through at once. */
    await sendMessage(page, 'E2E_REPLY:after');
    await expect(view.getByText('E2E reply after')).toBeVisible({ timeout: 30000 });
  });
});
