import { join } from 'path';
import { readFileSync } from 'fs';
import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import {
  isAgentsStream,
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  mockReply,
  replyText,
  replyPrompt,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

type UploadFixture = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

/* A real digital PDF, not a hand-built one. The previous inline fixture declared ZERO pages, so
 * nothing could extract text from it — it only uploaded successfully because the native fallback
 * handed the file's own bytes back as its "text", which is the defect this suite should be
 * catching rather than depending on. */
const pdfFixture: UploadFixture = {
  name: 'provider-context.pdf',
  mimeType: 'application/pdf',
  buffer: readFileSync(join(__dirname, '../../fixtures/files/digital.pdf')),
};

const textFixture: UploadFixture = {
  name: 'provider-context.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('This text attachment should be available to the mock model.\n'),
};

const imageFixture: UploadFixture = {
  name: 'provider-context.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ),
};

const composer = (page: Page) => page.locator('form');

async function openProviderFileChooser(page: Page) {
  // The fork's composer uses a single paperclip that opens the file chooser
  // directly (no upload-type menu). "Attach Files" is also a sidebar nav button,
  // so scope to the composer form.
  const composerForm = page
    .locator('form')
    .filter({ has: page.getByRole('textbox', { name: 'Message input' }) });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await composerForm.getByRole('button', { name: 'Attach Files' }).click();
  const fileChooser = await fileChooserPromise;
  expect(await fileChooser.element().getAttribute('type')).toBe('file');
  return fileChooser;
}

const FILE_UPLOAD = (response: Response) =>
  response.url().includes('/api/files') &&
  response.request().method() === 'POST' &&
  response.status() === 200;

/**
 * The attach type is chosen by the "Document handling" toolbar control. Switch
 * a non-image document to "Original file" (native) so it reaches the model as a
 * provider input_file; the switch deletes and re-uploads the file.
 */
async function selectNativeFileMode(page: Page) {
  const trigger = page.getByRole('button', { name: 'Document handling' });
  await expect(trigger).toBeVisible();
  if (((await trigger.textContent()) ?? '').includes('Original file')) {
    return;
  }
  const reupload = page.waitForResponse(FILE_UPLOAD, { timeout: 30000 }).catch(() => undefined);
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Original file' }).click();
  await reupload;
  await expect(trigger).toContainText('Original file');
}

async function attachFile(page: Page, fixture: UploadFixture) {
  const fileChooser = await openProviderFileChooser(page);
  const uploadResponsePromise = page.waitForResponse(FILE_UPLOAD, { timeout: 30000 });
  await fileChooser.setFiles(fixture);
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok()).toBeTruthy();
  return uploadResponse;
}

/**
 * Attach a document and switch it to native "Original file" handling so it
 * reaches the model as a provider input_file. The mode applies to the next
 * upload, so callers that need a native single file should attach it after a
 * prior document set the mode (images are always native and have no control).
 */
async function uploadProviderFile(page: Page, fixture: UploadFixture) {
  const uploadResponse = await attachFile(page, fixture);
  if (!fixture.mimeType.startsWith('image/')) {
    await selectNativeFileMode(page);
  }
  return uploadResponse;
}

test.describe('core chat loop', () => {
  test('streams a response, saves the conversation, and persists across reload', async ({
    page,
  }) => {
    test.setTimeout(60000);
    const userMessage = 'ping from e2e';

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, userMessage);
    expect(response.ok()).toBeTruthy();

    await expect(page.getByText(userMessage)).toBeVisible();
    const userMessageTurn = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: userMessage });
    await expect(userMessageTurn.locator('.user-turn')).toBeVisible();
    await expect(userMessageTurn.locator('.agent-turn')).toHaveCount(0);
    /* Explicit, like every other reply assertion in this file. This one relied
     * on the 10s default and is the first test in the file, so it pays for the
     * worker's cold start — it fails on a slow machine while CI, which is
     * faster, never sees it. Verified pre-existing: it fails the same way with
     * this file restored to origin/main. */
    await expect(mockReply(page)).toBeVisible({ timeout: 30000 });

    await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/);
    const conversationUrl = page.url();

    await expect(page.getByTestId('convo-item').first()).toBeVisible();

    await page.reload({ timeout: 10000 });
    await expect(page).toHaveURL(conversationUrl);
    await expect(page.getByText(userMessage)).toBeVisible();
    await expect(mockReply(page)).toBeVisible();
    await expect(page.getByTestId('convo-item').first()).toBeVisible();
  });

  test('keeps send disabled until the composer has message text', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const input = page.getByRole('textbox', { name: 'Message input' });
    const sendButton = page.getByTestId('send-button');

    await expect(sendButton).toBeDisabled();
    await input.fill('ready to send');
    await expect(sendButton).toBeEnabled();
    await input.fill('   ');
    await expect(sendButton).toBeDisabled();
  });

  test('renders assistant markdown and syntax-highlighted code blocks', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, 'E2E_MARKDOWN_REPLY');
    expect(response.ok()).toBeTruthy();

    const assistantMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: 'E2E markdown heading' })
      .last();
    await expect(assistantMessage.locator('.agent-turn')).toBeVisible();
    await expect(
      assistantMessage.getByRole('heading', { name: 'E2E markdown heading' }),
    ).toBeVisible();
    await expect(
      assistantMessage.locator('strong').filter({ hasText: 'E2E bold text' }),
    ).toBeVisible();
    await expect(
      assistantMessage.getByRole('listitem').filter({ hasText: 'E2E list item' }),
    ).toBeVisible();

    const codeBlock = assistantMessage.locator('code').filter({ hasText: 'e2eSyntaxHighlight' });
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toHaveClass(/hljs/);
    await expect(codeBlock).toHaveClass(/language-javascript/);
  });

  /**
   * The copy button on a code block.
   *
   * Read back from the real clipboard rather than from a stubbed
   * `navigator.clipboard`: the app copies through `copy-to-clipboard`, which
   * uses `document.execCommand` and a hidden textarea, so a stub on the modern
   * API would sit there unused and the test would pass on a build that copies
   * nothing at all.
   */
  test('the copy button on a code block puts the code on the clipboard', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, 'E2E_MARKDOWN_REPLY');
    expect(response.ok()).toBeTruthy();

    const assistantMessage = messagesView(page)
      .locator('.message-render')
      .filter({ hasText: 'E2E markdown heading' })
      .last();
    const codeBlock = assistantMessage.locator('code').filter({ hasText: 'e2eSyntaxHighlight' });
    await expect(codeBlock).toBeVisible();

    /* Emptied first, so a value left by anything earlier cannot pass for the
     * value this click is supposed to write. */
    await page.evaluate(() => navigator.clipboard.writeText('e2e-clipboard-was-not-written'));

    await assistantMessage.getByRole('button', { name: 'Copy code' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15000 })
      .toBe('const e2eSyntaxHighlight = "ok";');
  });

  test('can switch back to the previous branch after regenerating an earlier response', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const firstMessage = 'branch root from e2e';
    const followUpMessage = 'follow-up on original branch from e2e';

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    let response = await sendMessage(page, firstMessage);
    expect(response.ok()).toBeTruthy();
    await expect(mockReply(page)).toBeVisible();

    response = await sendMessage(page, followUpMessage);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByText(followUpMessage)).toBeVisible();

    const firstAssistantMessage = messagesView(page).locator('.message-render').nth(1);
    await firstAssistantMessage.hover();
    const regenerateButton = firstAssistantMessage
      .locator('button[aria-label="Regenerate"]')
      .last();
    await expect(regenerateButton).toBeVisible();

    const [regenerateResponse] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      regenerateButton.click(),
    ]);
    expect(regenerateResponse.ok()).toBeTruthy();

    await expect(page.getByText('2 / 2')).toBeVisible();
    await page.getByRole('button', { name: 'Previous variant' }).click();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByText(followUpMessage)).toBeVisible();
  });

  test('keeps the viewed branch when regenerating its latest response with an earlier branch present', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const firstMessage = 'first turn from e2e';
    const secondMessage = 'second turn from e2e';

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    let response = await sendMessage(page, firstMessage);
    expect(response.ok()).toBeTruthy();
    await expect(mockReply(page).first()).toBeVisible();
    response = await sendMessage(page, secondMessage);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByText(secondMessage)).toBeVisible();

    // Regenerate the INITIAL response → a second root-level branch the second
    // turn does not belong to.
    const firstAssistant = messagesView(page).locator('.message-render').nth(1);
    await firstAssistant.hover();
    const regenInitial = firstAssistant.locator('button[aria-label="Regenerate"]').last();
    await expect(regenInitial).toBeVisible();
    [response] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      regenInitial.click(),
    ]);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByText('2 / 2')).toBeVisible();
    await expect(page.getByText(secondMessage)).toHaveCount(0);

    // Back to the ORIGINAL branch (both turns present).
    await page.getByRole('button', { name: 'Previous variant' }).click();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByText(secondMessage)).toBeVisible();

    // Regenerate the LATEST response on the original branch. The bug snapped the
    // root fork back to the newest (regenerated-initial) branch, dropping the
    // original thread; the view must stay put.
    const latestAssistant = messagesView(page).locator('.message-render').last();
    await latestAssistant.hover();
    const regenLatest = latestAssistant.locator('button[aria-label="Regenerate"]').last();
    await expect(regenLatest).toBeVisible();
    [response] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      regenLatest.click(),
    ]);
    expect(response.ok()).toBeTruthy();

    // Still on the original branch: the second turn survives and the root fork
    // still reads 1 / 2 (rather than snapping to the regenerated-initial branch).
    await expect(page.getByText(secondMessage)).toBeVisible();
    await expect(page.getByText('1 / 2')).toBeVisible();
  });

  test('preserves a long original branch when regenerating early then later on it', async ({
    page,
  }) => {
    test.setTimeout(150000);
    // Labeled prompts give each turn a unique reply, so we can both settle on
    // it (turn complete) and assert which branch is visible.
    const turns = [
      { prompt: replyPrompt('lb-one'), reply: replyText('lb-one') },
      { prompt: replyPrompt('lb-two'), reply: replyText('lb-two') },
      { prompt: replyPrompt('lb-three'), reply: replyText('lb-three') },
    ];

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    // Build a three-turn thread (the "long running thread"), waiting for each
    // turn's unique reply to render before sending the next.
    for (const turn of turns) {
      const response = await sendMessage(page, turn.prompt);
      expect(response.ok()).toBeTruthy();
      await expect(messagesView(page).getByText(turn.reply)).toBeVisible({ timeout: 30000 });
    }

    // Regenerate from an EARLIER part of the branch (the first response). This
    // forks a fresh root branch that does not contain the later turns.
    const earlyAssistant = messagesView(page).locator('.message-render').nth(1);
    await earlyAssistant.hover();
    const regenEarly = earlyAssistant.locator('button[aria-label="Regenerate"]').last();
    await expect(regenEarly).toBeVisible();
    let [response] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      regenEarly.click(),
    ]);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByText('2 / 2')).toBeVisible();
    // The fresh branch does not contain the later turns' replies.
    await expect(messagesView(page).getByText(turns[1].reply)).toHaveCount(0);
    await expect(messagesView(page).getByText(turns[2].reply)).toHaveCount(0);

    // Go back to the ORIGINAL branch — all three turns are present again.
    await page.getByRole('button', { name: 'Previous variant' }).click();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(messagesView(page).getByText(turns[1].reply)).toBeVisible();
    await expect(messagesView(page).getByText(turns[2].reply)).toBeVisible();

    // Regenerate from LATER in the original branch (its latest response). The
    // bug snapped the early fork back to the regenerated branch, collapsing the
    // long original thread; it must stay intact.
    const lateAssistant = messagesView(page).locator('.message-render').last();
    await lateAssistant.hover();
    const regenLate = lateAssistant.locator('button[aria-label="Regenerate"]').last();
    await expect(regenLate).toBeVisible();
    [response] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      regenLate.click(),
    ]);
    expect(response.ok()).toBeTruthy();

    // The whole original branch survives and its first fork still reads 1 / 2.
    await expect(messagesView(page).getByText(turns[1].reply)).toBeVisible();
    await expect(page.getByText('1 / 2')).toBeVisible();
  });

  test('keeps an attached CSV through send and reload', async ({ page }) => {
    test.setTimeout(90000);

    const csvFixture: UploadFixture = {
      name: 'provider-upload.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,value\nalpha,1\n'),
    };
    const filename = csvFixture.name;
    const reply = replyText('csv-attach');
    const fileChip = messagesView(page).getByRole('button', { name: filename });

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    // The fork attaches a lone CSV as an extracted-text source (RAG), not a
    // native provider file; it still rides with the sent message and persists.
    await attachFile(page, csvFixture);
    await expect(composer(page).getByRole('button', { name: filename })).toBeVisible();

    const response = await sendMessage(page, replyPrompt('csv-attach'));
    expect(response.ok()).toBeTruthy();
    await expect(messagesView(page).getByText(reply)).toBeVisible({ timeout: 30000 });
    await expect(fileChip).toBeVisible();

    await expect(page).toHaveURL(/\/c\/[0-9a-fA-F-]{36}$/);
    const conversationUrl = page.url();
    await page.reload({ timeout: 10000 });
    await expect(page).toHaveURL(conversationUrl);
    await expect(fileChip).toBeVisible();
  });

  test('supports attaching, removing, and sending provider files from the composer', async ({
    page,
  }) => {
    test.setTimeout(90000);

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    await uploadProviderFile(page, pdfFixture);
    const pdfChip = composer(page).getByRole('button', { name: pdfFixture.name });
    await expect(pdfChip).toBeVisible();

    await composer(page).getByRole('button', { name: 'Remove file' }).click();
    await expect(pdfChip).toHaveCount(0);

    await uploadProviderFile(page, imageFixture);
    await expect(
      composer(page).getByRole('button', { name: 'View Preview image in full size' }),
    ).toBeVisible();

    await uploadProviderFile(page, textFixture);
    const textChip = composer(page).getByRole('button', { name: textFixture.name });
    await expect(textChip).toBeVisible();

    const assertionText = `E2E_ASSERT_PROVIDER_FILE:${textFixture.name}`;
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.click();
    await input.fill(assertionText);
    await expect(page.getByTestId('send-button')).toBeEnabled();

    const [response] = await Promise.all([
      page.waitForResponse(isAgentsStream, { timeout: 30000 }),
      page.getByTestId('send-button').click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await expect(
      messagesView(page).getByText(`E2E provider file assertion passed: ${textFixture.name}`),
    ).toBeVisible();
    await expect(messagesView(page).getByRole('button', { name: textFixture.name })).toBeVisible();
  });
});

test.describe('interrupting a reply in progress', () => {
  /**
   * Leaving and coming back mid-answer keeps what the server had already
   * written down. That is what a user notices when a tab reloads, a phone
   * locks, or they navigate away and back while the model is still typing.
   *
   * **This is not a dropped-connection test, and an earlier version of it
   * claimed to be one.** It called `context.setOffline(true)` mid-stream and
   * read the reply back. Measured on 2026-08-05: the stream went from chunk 5
   * to chunk 60 during four seconds of being "offline", and a CDP
   * `Network.emulateNetworkConditions { offline: true }` did the same — chunk
   * 11 to chunk 65. Neither severs a Server-Sent Events connection that is
   * already established; both only affect new requests. The offline block
   * could be deleted with no change in outcome, which is the definition of an
   * assertion that proves nothing.
   *
   * What a real disconnect does to the client-side buffer is therefore still
   * uncovered, and recorded as a gap in e2e/COVERAGE_MAP.md rather than
   * pretended at here.
   */
  test('a reload mid-reply keeps everything the server had already persisted', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const prompt = 'E2E_SLOW_REPLY:connection-drop';
    await sendMessage(page, prompt);
    const reply = messagesView(page).getByText(/E2E slow reply connection-drop/);
    await expect(reply).toBeVisible({ timeout: 60000 });
    /* Well past the first chunk, so the reload lands mid-stream rather than
     * before anything meaningful has been written down. */
    await expect(reply).toContainText('chunk-005', { timeout: 60000 });

    await page.reload({ timeout: 30000 });

    await expect(messagesView(page).getByText(prompt)).toBeVisible({ timeout: 30000 });
    const persisted = messagesView(page).getByText(/E2E slow reply connection-drop/);
    await expect(persisted).toBeVisible({ timeout: 30000 });
    await expect(persisted).toContainText('chunk-005');
  });
});
