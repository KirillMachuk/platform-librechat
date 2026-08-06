import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  isAgentsStream,
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  escapeRegExp,
  fetchJson,
  getAccessToken,
  replyPrompt,
  replyText,
  requestJson,
  selectMockEndpoint,
} from './helpers';

const DESCRIPTION = 'Use this prompt to verify LibreChat prompt creation in mock e2e tests.';
const COMMAND = 'e2e-prompt';

type Prompt = {
  _id?: string;
  groupId: string;
  prompt: string;
  type: 'text' | 'chat';
};

type PromptGroup = {
  _id?: string;
  name: string;
  oneliner?: string;
  command?: string;
  productionPrompt?: Pick<Prompt, 'prompt'> | null;
};

type PromptGroupListResponse = {
  promptGroups?: PromptGroup[];
};

const uniquePromptName = () => `E2E Prompt ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function findPromptGroup(
  page: Page,
  promptName: string,
  token: string,
): Promise<PromptGroup | null> {
  const body = await fetchJson<PromptGroupListResponse>(
    page,
    `/api/prompts/groups?name=${encodeURIComponent(promptName)}&limit=10`,
    token,
  );
  return body.promptGroups?.find((group) => group.name === promptName) ?? null;
}

async function waitForPersistedPrompt(
  page: Page,
  promptName: string,
  expectedPrompt: string,
): Promise<{ group: PromptGroup; prompts: Prompt[] }> {
  const token = await getAccessToken(page);
  let latestGroup: PromptGroup | null = null;
  let latestPrompts: Prompt[] = [];

  for (let attempt = 0; attempt < 20; attempt++) {
    const group = await findPromptGroup(page, promptName, token);
    if (group?._id) {
      latestGroup = await fetchJson<PromptGroup>(
        page,
        `/api/prompts/groups/${encodeURIComponent(group._id)}`,
        token,
      );
      latestPrompts = await fetchJson<Prompt[]>(
        page,
        `/api/prompts?groupId=${encodeURIComponent(group._id)}`,
        token,
      );

      const hasExpectedPrompt = latestPrompts.some((prompt) => prompt.prompt === expectedPrompt);
      if (
        latestGroup.oneliner === DESCRIPTION &&
        latestGroup.command === COMMAND &&
        latestGroup.productionPrompt?.prompt === expectedPrompt &&
        hasExpectedPrompt
      ) {
        return { group: latestGroup, prompts: latestPrompts };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect(latestGroup, `Expected prompt group "${promptName}" to be persisted`).not.toBeNull();
  expect(latestGroup?.oneliner).toBe(DESCRIPTION);
  expect(latestGroup?.command).toBe(COMMAND);
  expect(latestGroup?.productionPrompt?.prompt).toBe(expectedPrompt);
  expect(latestPrompts.some((prompt) => prompt.prompt === expectedPrompt)).toBe(true);
  return { group: latestGroup!, prompts: latestPrompts };
}

async function cleanupPromptGroup(page: Page, groupId?: string) {
  if (!groupId) {
    return;
  }

  const token = await getAccessToken(page);
  await requestJson<{ message?: string }>(page, {
    path: `/api/prompts/groups/${encodeURIComponent(groupId)}`,
    token,
    method: 'DELETE',
  });
}

async function openPromptsPanel(page: Page) {
  const promptsButton = page.getByRole('button', { name: 'Prompts', exact: true });
  await expect(promptsButton).toBeVisible();
  if ((await promptsButton.getAttribute('aria-pressed')) !== 'true') {
    await promptsButton.click();
  }
  await expect(page.getByRole('search')).toBeVisible();
}

async function ensureAutoSendPrompts(page: Page) {
  const autoSend = page.getByRole('button', { name: 'Send prompts on select' });
  await expect(autoSend).toBeVisible();
  if ((await autoSend.getAttribute('aria-pressed')) !== 'true') {
    await autoSend.click();
  }
  await expect(autoSend).toHaveAttribute('aria-pressed', 'true');
}

test.describe('prompt manager', () => {
  test('creates a prompt and can send it from chat', async ({ page }) => {
    test.setTimeout(120000);

    const promptName = uniquePromptName();
    const label = promptName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const promptText = replyPrompt(label);
    let createdGroupId: string | undefined;

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
      await openPromptsPanel(page);

      await page.getByRole('link', { name: 'Create Prompt' }).click();
      await expect(page).toHaveURL(/\/prompts\/new$/);

      // The Prompts popup stays open over the create page in the fork; dismiss it
      // so its overlay doesn't sit over the form and swallow the submit click.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByRole('textbox', { name: 'Prompt Name' }).fill(promptName);
      await page.getByRole('textbox', { name: 'Prompt text input field' }).fill(promptText);
      await page
        .getByRole('textbox', { name: 'Optional: Enter a description to display for the prompt' })
        .fill(DESCRIPTION);
      await page
        .getByRole('textbox', {
          name: 'Optional: Enter a command for the prompt or name will be used',
        })
        .fill(COMMAND);

      // The submit button stays aria-disabled until react-hook-form revalidates
      // the just-filled fields; wait for it to enable so the click isn't
      // preventDefault-ed (which would silently skip the POST).
      const createButton = page.getByRole('button', { name: 'Create Prompt' });
      await expect(createButton).toBeEnabled();
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/prompts' &&
            response.status() >= 200 &&
            response.status() < 300,
          { timeout: 30000 },
        ),
        createButton.click(),
      ]);
      const createdPrompt = (await createResponse.json()) as {
        group?: PromptGroup;
        prompt?: Prompt;
      };
      createdGroupId = createdPrompt.group?._id ?? createdPrompt.prompt?.groupId;

      const { group } = await waitForPersistedPrompt(page, promptName, promptText);
      createdGroupId = group._id ?? createdGroupId;
      expect(createdGroupId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/prompts/${createdGroupId}$`));
      await expect(page.getByRole('button', { name: `Edit: ${promptName}` })).toBeVisible();

      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
      await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
      await openPromptsPanel(page);
      await ensureAutoSendPrompts(page);

      await page.getByLabel('Filter prompts by name').fill(promptName);
      const promptCard = page.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(promptName)} prompt`),
      });
      await expect(promptCard).toBeVisible({ timeout: 10000 });

      const [response] = await Promise.all([
        page.waitForResponse(isAgentsStream, { timeout: 30000 }),
        promptCard.click(),
      ]);
      expect(response.ok()).toBeTruthy();

      await expect(page.getByTestId('messages-view').getByText(promptText)).toBeVisible();
      await expect(page.getByTestId('messages-view').getByText(replyText(label))).toBeVisible({
        timeout: 30000,
      });
    } finally {
      await cleanupPromptGroup(page, createdGroupId);
    }
  });

  /**
   * Editing was the half of the prompt manager nothing looked at: the test
   * above creates a prompt and sends it, and stops there.
   *
   * Rewriting the text does not overwrite it. The group keeps every version and
   * points at one of them as production, and it is the production one a chat
   * sends — so the assertion that matters is not "the textarea now reads X" but
   * "the old text is still on record and the new one is what would be sent".
   *
   * The prompt is created through the API rather than the form. The form is
   * already covered above; repeating it here would only make this test slower
   * and give it a second way to fail for reasons that have nothing to do with
   * editing.
   */
  test('editing a prompt adds a version and it is the new one that gets sent', async ({ page }) => {
    test.setTimeout(120000);

    const promptName = uniquePromptName();
    const original = replyPrompt('before-the-edit');
    const rewritten = replyPrompt('after-the-edit');
    let groupId: string | undefined;

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

      const token = await getAccessToken(page);
      const created = await requestJson<{ prompt?: Prompt; group?: PromptGroup }>(page, {
        path: '/api/prompts',
        token,
        method: 'POST',
        body: {
          prompt: { prompt: original, type: 'text' },
          group: { name: promptName, category: '', oneliner: DESCRIPTION },
        },
      });
      groupId = created.group?._id ?? created.prompt?.groupId;
      expect(groupId).toBeTruthy();

      await page.goto(`/prompts/${groupId}`, { timeout: 15000 });
      await expect(page.getByText(original)).toBeVisible();

      /* The editor toggle and the invisible overlay that covers the preview
       * both answer to "Edit"; either opens the same textarea. */
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
      const editor = page.getByRole('textbox', { name: 'Prompt input' });
      await expect(editor).toBeVisible();
      await editor.fill(rewritten);

      /* Leaving edit mode is what saves — the form submits on the way out. A
       * version goes to the group's own endpoint, not to the one that created
       * the group. */
      const [saved] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `/api/prompts/groups/${groupId}/prompts` &&
            response.ok(),
          { timeout: 30000 },
        ),
        page.getByRole('button', { name: 'Save', exact: true }).first().click(),
      ]);
      expect(saved.ok()).toBeTruthy();

      const versions = await fetchJson<Prompt[]>(
        page,
        `/api/prompts?groupId=${encodeURIComponent(groupId!)}`,
        token,
      );
      /* Both, in this order of importance: the rewrite is on record, and the
       * original was not replaced by it. A test that only looked for the new
       * text would pass on a build that quietly threw the old version away. */
      expect(versions.map((version) => version.prompt).sort()).toEqual([original, rewritten].sort());

      const group = await fetchJson<PromptGroup>(
        page,
        `/api/prompts/groups/${encodeURIComponent(groupId!)}`,
        token,
      );
      expect(group.productionPrompt?.prompt).toBe(rewritten);

      /* And the point of all of it: a chat sends the rewrite. */
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
      await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
      await openPromptsPanel(page);
      await ensureAutoSendPrompts(page);
      await page.getByLabel('Filter prompts by name').fill(promptName);
      const promptCard = page.getByRole('button', {
        name: new RegExp(`^${escapeRegExp(promptName)} prompt`),
      });
      await expect(promptCard).toBeVisible({ timeout: 10000 });
      await Promise.all([
        page.waitForResponse(isAgentsStream, { timeout: 30000 }),
        promptCard.click(),
      ]);
      await expect(page.getByTestId('messages-view').getByText(rewritten)).toBeVisible();
      await expect(page.getByTestId('messages-view').getByText(original)).toHaveCount(0);
    } finally {
      await cleanupPromptGroup(page, groupId);
    }
  });
});
