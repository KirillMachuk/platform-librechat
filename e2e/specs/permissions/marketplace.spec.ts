import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAgentBuilder, selectFromSearchCombobox } from '../mock/agents.helpers';
import { getSecondaryE2EUser } from '../../setup/users.mock';
import { ensureSecondaryUser } from '../../setup/secondaryUser';

/**
 * The agent marketplace, and the sharing that fills it.
 *
 * Both were dark. `MARKETPLACE.USE` and `AGENTS.SHARE_PUBLIC` are off in the
 * deployment, so nothing had ever opened the marketplace screen or watched an
 * agent arrive on it — and the marketplace is not a separate list, it is
 * `GET /api/agents` filtered by who may view what. A build where sharing wrote
 * the wrong permission bit, or where the marketplace ignored the filter, looked
 * identical from outside: an empty screen either way.
 *
 * So the test is a pair again. One agent shared with everyone, one left alone,
 * both looked for by the same second person on the same screen. The unshared
 * one is what catches a marketplace that shows everything to everybody, which
 * is the failure that matters when this is switched on for real.
 */
const CHAT = '/c/new';
const MARKETPLACE = '/agents';

type AgentCreated = { id?: string; _id?: string };

async function accessToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return ((await response.json()) as { token?: string }).token ?? '';
  });
}

async function createAgent(page: Page, token: string, name: string): Promise<string> {
  const created = await page.evaluate(
    async ({ authToken, agentName }) => {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          description: 'Fixture for the marketplace test.',
          instructions: 'Reply through the mock model.',
          provider: 'Mock Provider A',
          model: 'mock-model-a',
          category: 'general',
        }),
      });
      if (!response.ok) {
        throw new Error(`creating "${agentName}" returned ${response.status}`);
      }
      return response.json() as Promise<AgentCreated>;
    },
    { authToken: token, agentName: name },
  );
  const id = created.id ?? created._id;
  expect(id, `agent "${name}" should have an id`).toBeTruthy();
  return id as string;
}

async function deleteAgent(page: Page, token: string, id: string | undefined) {
  if (!id) {
    return;
  }
  await page
    .evaluate(
      async ({ authToken, agentId }) => {
        await fetch(`/api/agents/${agentId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      },
      { authToken: token, agentId: id },
    )
    .catch(() => undefined);
}

/**
 * Searches the marketplace the way a person does, and answers how many cards
 * came back.
 *
 * Counted by the card's own accessible name, not by a heading: the card puts
 * the agent's name in a `Label`, and the first version of this looked for a
 * heading and found nothing on a screen that was in fact showing the agent.
 *
 * The wait is on the result banner rather than on a card, because "no cards" is
 * a real answer here and waiting for a card to appear cannot express it. The
 * banner is rendered by the same grid either way.
 */
async function marketplaceHits(page: Page, name: string): Promise<number> {
  const search = page.getByPlaceholder('Search agents...');
  await expect(search).toBeVisible({ timeout: 20000 });

  /* Armed before typing. The server's answer to THIS search is the only event
   * that happens in both outcomes; the result banner does not, which the first
   * version of this got wrong — it waited for "Showing N agents", and on the
   * run where the sharing was deliberately broken there were no results, no
   * banner, and the test failed on the wait instead of on the count. */
  const answered = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/agents' && url.searchParams.get('search') === name && response.ok()
      );
    },
    { timeout: 30000 },
  );
  await search.fill(name, { timeout: 15000 });
  await answered;

  /* And then the render of that answer, which is one of two things. Waiting on
   * either keeps the read off a fixed sleep; waiting on the response first
   * keeps it off the PREVIOUS search's banner, which would still be on screen. */
  await expect(
    page.getByLabel(/Showing \d+ agents/).or(page.getByText(/No search results|No agents found/)),
  ).toBeVisible({ timeout: 20000 });

  return page.locator(`[aria-label^=${JSON.stringify(`${name} agent.`)}]`).count();
}

test.describe('the agent marketplace', () => {
  test('an agent shared with everyone reaches the marketplace, an unshared one does not', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240000);
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL must be configured for the marketplace test');
    }

    const stamp = `${Date.now()}`;
    const sharedName = `E2E Shared Agent ${stamp}`;
    const privateName = `E2E Private Agent ${stamp}`;
    let token = '';
    let sharedId: string | undefined;
    let privateId: string | undefined;

    const contextB = await browser.newContext({ storageState: undefined, baseURL });
    const pageB = await contextB.newPage();
    try {
      await page.goto(CHAT, { timeout: 30000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      token = await accessToken(page);

      sharedId = await createAgent(page, token, sharedName);
      privateId = await createAgent(page, token, privateName);

      /* B before the grant: registering wipes and recreates the account, which
       * would throw away access granted to the previous one. */
      await ensureSecondaryUser(browser, pageB, getSecondaryE2EUser(), baseURL);

      const form = await openAgentBuilder(page);
      await selectFromSearchCombobox(
        page,
        form.getByRole('combobox', { name: 'Agent', exact: true }),
        'Search agents by name',
        sharedName,
      );
      await expect(form.getByLabel('Agent name')).toHaveValue(sharedName);

      /* Remote access sits next to Share and is gated by its own permission,
       * REMOTE_AGENTS.SHARE. Asserted here rather than in its own test because
       * this is the only screen that offers it, and it is one more permission
       * the deployment has never switched on. */
      await expect(page.getByRole('button', { name: 'Remote Access' })).toBeVisible();

      await page.getByRole('button', { name: `Share ${sharedName}` }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Share with everyone' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('switch', { name: 'Share with everyone' }).click();

      const granted = page.waitForResponse(
        (response) =>
          /\/api\/permissions\//.test(new URL(response.url()).pathname) &&
          response.request().method() === 'PUT' &&
          response.ok(),
        { timeout: 30000 },
      );
      await dialog.getByRole('button', { name: 'Save Changes' }).click({ timeout: 15000 });
      await granted;
      /* Exact: the toast is announced twice, once visibly and once in a
       * `role="status"` live region that reads "Notification " first. */
      await expect(page.getByText('Permissions updated successfully', { exact: true })).toBeVisible(
        { timeout: 15000 },
      );

      await pageB.goto(MARKETPLACE, { timeout: 30000 });
      await expect(pageB.getByRole('heading', { name: 'Agent Marketplace' })).toBeVisible({
        timeout: 20000,
      });

      expect(await marketplaceHits(pageB, sharedName)).toBe(1);
      /* The control. Same screen, same search box, same person — the only
       * difference is that this one was never shared. */
      expect(await marketplaceHits(pageB, privateName)).toBe(0);
    } finally {
      await contextB.close();
      await deleteAgent(page, token, sharedId);
      await deleteAgent(page, token, privateId);
    }
  });
});
