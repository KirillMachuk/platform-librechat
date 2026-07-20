import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { AgentDetail } from './agents.helpers';
import {
  cleanupAgent,
  openAgentBuilder,
  selectMockModel,
  uniqueAgentName,
  waitForPersistedAgent,
  selectFromSearchCombobox,
  closeAgentBuilder,
} from './agents.helpers';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  getAccessToken,
  mockReply,
  requestJson,
  sendMessage,
} from './helpers';

const DESCRIPTION = 'Use this agent to verify LibreChat agent creation in mock end-to-end tests.';
const INSTRUCTIONS =
  'Reply through the mock e2e model and keep this agent available for UI persistence checks.';
const MODEL_PARAMETERS = {
  maxContextTokens: 32000,
  maxOutputTokens: 4096,
  temperature: 0.25,
  topP: 0.8,
  topK: 12,
  resendFiles: false,
  promptCache: true,
  thinking: true,
  thinkingBudget: 2000,
  web_search: true,
  fileTokenLimit: 12000,
};
const PERSISTED_MODEL_PARAMETERS = {
  maxContextTokens: MODEL_PARAMETERS.maxContextTokens,
  maxOutputTokens: MODEL_PARAMETERS.maxOutputTokens,
  temperature: MODEL_PARAMETERS.temperature,
  topP: MODEL_PARAMETERS.topP,
  topK: MODEL_PARAMETERS.topK,
  resendFiles: MODEL_PARAMETERS.resendFiles,
  web_search: MODEL_PARAMETERS.web_search,
  fileTokenLimit: MODEL_PARAMETERS.fileTokenLimit,
};

async function setSwitch(form: Locator, name: string, checked: boolean) {
  const control = form.getByRole('switch', { name, exact: true });
  await expect(control).toBeVisible();
  if ((await control.getAttribute('aria-checked')) !== String(checked)) {
    await control.click();
  }
  await expect(control).toHaveAttribute('aria-checked', String(checked));
}

async function fillAnthropicStyleModelParameters(page: Page) {
  const form = page.getByRole('form', { name: 'Agent configuration form' });

  await expect(form.getByLabel('Max Context Tokens')).toBeVisible();
  await expect(form.getByLabel('Max Output Tokens')).toBeVisible();
  await expect(form.getByText('Temperature', { exact: true })).toBeVisible();
  await expect(form.getByText('Top P', { exact: true })).toBeVisible();
  await expect(form.getByText('Top K', { exact: true })).toBeVisible();
  await expect(form.getByText('Effort', { exact: true })).toBeVisible();
  await expect(form.getByText('Thought Visibility', { exact: true })).toBeVisible();

  await form
    .locator('#maxContextTokens-dynamic-input')
    .fill(`${MODEL_PARAMETERS.maxContextTokens}`);
  await form.locator('#maxOutputTokens-dynamic-input').fill(`${MODEL_PARAMETERS.maxOutputTokens}`);
  await form
    .locator('#temperature-dynamic-setting-input-number')
    .fill(`${MODEL_PARAMETERS.temperature}`);
  await form.locator('#topP-dynamic-setting-input-number').fill(`${MODEL_PARAMETERS.topP}`);
  await form.locator('#topK-dynamic-setting-input-number').fill(`${MODEL_PARAMETERS.topK}`);
  await form.locator('#thinkingBudget-dynamic-input').fill(`${MODEL_PARAMETERS.thinkingBudget}`);
  await form.locator('#fileTokenLimit-dynamic-input').fill(`${MODEL_PARAMETERS.fileTokenLimit}`);

  await setSwitch(form, 'Resend Files', MODEL_PARAMETERS.resendFiles);
  await setSwitch(form, 'Use Prompt Caching', MODEL_PARAMETERS.promptCache);
  await setSwitch(form, 'Thinking', MODEL_PARAMETERS.thinking);
  await setSwitch(form, 'Web Search', MODEL_PARAMETERS.web_search);

  // DynamicInput/DynamicSlider values use a 450ms debounced form update.
  await page.waitForTimeout(600);
}

async function expectAnthropicStyleModelParameters(page: Page) {
  const form = page.getByRole('form', { name: 'Agent configuration form' });

  await expect(form.locator('#maxContextTokens-dynamic-input')).toHaveValue(
    `${MODEL_PARAMETERS.maxContextTokens}`,
  );
  await expect(form.locator('#maxOutputTokens-dynamic-input')).toHaveValue(
    `${MODEL_PARAMETERS.maxOutputTokens}`,
  );
  await expect(form.locator('#temperature-dynamic-setting-input-number')).toHaveValue(
    `${MODEL_PARAMETERS.temperature}`,
  );
  await expect(form.locator('#topP-dynamic-setting-input-number')).toHaveValue(
    MODEL_PARAMETERS.topP.toFixed(2),
  );
  await expect(form.locator('#topK-dynamic-setting-input-number')).toHaveValue(
    `${MODEL_PARAMETERS.topK}`,
  );
  await expect(form.locator('#thinkingBudget-dynamic-input')).toHaveValue(
    `${MODEL_PARAMETERS.thinkingBudget}`,
  );
  await expect(form.locator('#fileTokenLimit-dynamic-input')).toHaveValue(
    `${MODEL_PARAMETERS.fileTokenLimit}`,
  );

  await expect(form.getByRole('switch', { name: 'Resend Files', exact: true })).toHaveAttribute(
    'aria-checked',
    String(MODEL_PARAMETERS.resendFiles),
  );
  await expect(
    form.getByRole('switch', { name: 'Use Prompt Caching', exact: true }),
  ).toHaveAttribute('aria-checked', String(MODEL_PARAMETERS.promptCache));
  await expect(form.getByRole('switch', { name: 'Thinking', exact: true })).toHaveAttribute(
    'aria-checked',
    String(MODEL_PARAMETERS.thinking),
  );
  await expect(form.getByRole('switch', { name: 'Web Search', exact: true })).toHaveAttribute(
    'aria-checked',
    String(MODEL_PARAMETERS.web_search),
  );
}

test.describe('agent builder', () => {
  test('creates an agent, persists its configuration, and can chat with it', async ({ page }) => {
    test.setTimeout(120000);

    const agentName = uniqueAgentName('E2E Agent');
    let createdAgentId: string | undefined;

    try {
      let form = await openAgentBuilder(page);

      await form.getByLabel('Agent name').fill(agentName);
      await form.getByLabel('Agent description').fill(DESCRIPTION);
      await form.getByLabel('Agent instructions').fill(INSTRUCTIONS);

      await selectMockModel(page);
      await fillAnthropicStyleModelParameters(page);
      await page
        .getByRole('form', { name: 'Agent configuration form' })
        .getByRole('button', {
          name: 'Back to builder',
        })
        .click();
      form = page.getByRole('form', { name: 'Agent configuration form' });

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/agents' &&
            response.status() === 201,
          { timeout: 30000 },
        ),
        form.getByRole('button', { name: 'Create' }).click(),
      ]);
      const createdAgent = (await createResponse.json()) as AgentDetail;
      createdAgentId = createdAgent.id;

      /** `.first()`: the toast text also appears in the live-region announcer. */
      await expect(page.getByText(`Successfully created ${agentName}`).first()).toBeVisible();

      const persistedAgent = await waitForPersistedAgent(page, agentName, DESCRIPTION);
      expect(persistedAgent).toMatchObject({
        id: createdAgentId,
        name: agentName,
        description: DESCRIPTION,
        instructions: INSTRUCTIONS,
        provider: MOCK_ENDPOINTS[0].label,
        model: MOCK_ENDPOINTS[0].model,
        category: 'general',
      });
      expect(persistedAgent.model_parameters).toMatchObject(PERSISTED_MODEL_PARAMETERS);

      form = await openAgentBuilder(page);
      await selectFromSearchCombobox(
        page,
        form.getByRole('combobox', { name: 'Agent', exact: true }),
        'Search agents by name',
        agentName,
      );

      await expect(form.getByLabel('Agent name')).toHaveValue(agentName);
      await expect(form.getByLabel('Agent description')).toHaveValue(DESCRIPTION);
      await expect(form.getByLabel('Agent instructions')).toHaveValue(INSTRUCTIONS);

      await form.locator('label[for="provider"] + button').click();
      await expectAnthropicStyleModelParameters(page);
      await form.getByRole('button', { name: 'Back to builder' }).click();

      await form.getByRole('button', { name: 'Select Agent' }).click();
      await closeAgentBuilder(page, form);

      const response = await sendMessage(page, `hello from ${agentName}`);
      expect(response.ok()).toBeTruthy();
      await expect(mockReply(page)).toBeVisible({ timeout: 30000 });
    } finally {
      await cleanupAgent(page, createdAgentId);
    }
  });

  test('catalog: edit opens the builder and start chat closes the panel modal', async ({
    page,
  }) => {
    test.setTimeout(120000);

    const agentName = uniqueAgentName('E2E Catalog Agent');
    let createdAgentId: string | undefined;

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
      const token = await getAccessToken(page);
      const createdAgent = await requestJson<AgentDetail>(page, {
        path: '/api/agents',
        token,
        method: 'POST',
        body: {
          name: agentName,
          description: DESCRIPTION,
          provider: MOCK_ENDPOINTS[0].label,
          model: MOCK_ENDPOINTS[0].model,
          category: 'general',
        },
      });
      createdAgentId = createdAgent.id;

      /**
       * Controls inside the agent-detail dialog are activated by keyboard: the
       * stacked panel modal + dialog overlays intercept synthetic pointer clicks
       * (same workaround the combobox helpers use).
       */
      const openAgentsPanel = async () => {
        await page.getByRole('button', { name: 'Agents', exact: true }).click();
        await expect(page.getByTestId('agents-create-button')).toBeVisible();
      };

      /** Assumes the panel modal is already open and showing the catalog view. */
      const openCardFromCatalog = async () => {
        await page.getByLabel('Search for agents').fill(agentName);
        const card = page.getByRole('button', { name: new RegExp(agentName) }).first();
        await expect(card).toBeVisible();
        /** Keyboard activation: pointer clicks are swallowed by the panel modal's overlay. */
        await card.press('Enter');
        await expect(page.getByRole('heading', { name: agentName, exact: true })).toBeVisible();
      };

      await openAgentsPanel();
      await openCardFromCatalog();
      await page.getByTestId('agent-detail-edit-button').press('Enter');
      const form = page.getByRole('form', { name: 'Agent configuration form' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel('Agent name')).toHaveValue(agentName);
      await page.getByTestId('agents-back-button').click();

      await openCardFromCatalog();
      await page.getByRole('button', { name: 'Start Chat', exact: true }).press('Enter');

      /** Both layers must go: the agent detail dialog and the panel modal hosting the catalog. */
      await expect(page.getByRole('button', { name: 'Start Chat', exact: true })).toBeHidden();
      await expect(page.getByTestId('agents-create-button')).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: agentName })).toBeVisible();
    } finally {
      /** Never let teardown mask the assertion that actually failed. */
      await cleanupAgent(page, createdAgentId).catch(() => undefined);
    }
  });
});
