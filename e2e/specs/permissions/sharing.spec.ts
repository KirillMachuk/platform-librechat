import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getSecondaryE2EUser } from '../../setup/users.mock';
import { ensureSecondaryUser } from '../../setup/secondaryUser';

/**
 * Sharing a prompt with other people.
 *
 * This is here rather than in the mock profile because the deployment does not
 * have it switched on: `interface.prompts: true` seeds USE and CREATE and
 * leaves SHARE and SHARE_PUBLIC off, since the seeding only reads those from an
 * object carrying `share`/`public`. The owner intends to turn it on, so this
 * profile turns it on and covers what it unlocks — the behaviour is then proven
 * before the stand's yaml changes, not after somebody reports it broken.
 *
 * Two prompts, one shared and one not, both checked against the same second
 * person on the same screen. Without the unshared one, "B sees it" is also what
 * a build that shows everybody everything looks like, and that is the failure
 * worth catching when the switch is thrown for real.
 */
type Prompt = { _id?: string; groupId?: string };
type PromptGroup = { _id?: string };

const CHAT = '/c/new';

async function accessToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await response.json()) as { token?: string };
    return body.token ?? '';
  });
}

async function createPrompt(page: Page, token: string, name: string): Promise<string> {
  const created = await page.evaluate(
    async ({ authToken, promptName }) => {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: { prompt: 'E2E sharing fixture', type: 'text' },
          group: { name: promptName, category: '', oneliner: 'Fixture for the sharing test.' },
        }),
      });
      if (!response.ok) {
        throw new Error(`creating "${promptName}" returned ${response.status}`);
      }
      return response.json() as Promise<{ group?: PromptGroup; prompt?: Prompt }>;
    },
    { authToken: token, promptName: name },
  );
  const groupId = created.group?._id ?? created.prompt?.groupId;
  expect(groupId, `prompt "${name}" should have a group id`).toBeTruthy();
  return groupId as string;
}

async function deletePrompt(page: Page, token: string, groupId: string | undefined) {
  if (!groupId) {
    return;
  }
  await page.evaluate(
    async ({ authToken, id }) => {
      await fetch(`/api/prompts/groups/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    },
    { authToken: token, id: groupId },
  );
}

/**
 * Opens the prompts panel once and hands back its filter field.
 *
 * Once, because the panel is a full-screen Headless UI dialog: with it open, a
 * second click on the sidebar button lands on its own scrim instead. The
 * sidebar link carries no pressed state to check for, so "open it again if it
 * is closed" is not available — measured, the second call simply hung on the
 * scrim intercepting pointer events.
 *
 * Every step carries a timeout on purpose. Playwright's default action timeout
 * is unlimited, so a `fill` on a field that never appears hangs until the whole
 * test times out, and the failure then points at the cleanup rather than at the
 * step that never happened — which is exactly how the first run of this read.
 */
async function openPromptsPanel(page: Page) {
  const promptsButton = page.getByRole('button', { name: 'Prompts', exact: true });
  await expect(promptsButton).toBeVisible({ timeout: 20000 });
  await promptsButton.click({ timeout: 15000 });
  await expect(page.getByRole('search')).toBeVisible({ timeout: 15000 });
  const filter = page.getByLabel('Filter prompts by name');
  await expect(filter).toBeVisible({ timeout: 15000 });
  return filter;
}

const promptCard = (page: Page, name: string) =>
  page.getByRole('button', {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} prompt`),
  });

test.describe('sharing a prompt', () => {
  test('what is shared with everyone reaches someone else, what is not stays put', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180000);
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL must be configured for the sharing test');
    }

    const stamp = `${Date.now()}`;
    const sharedName = `E2E Shared Prompt ${stamp}`;
    const privateName = `E2E Private Prompt ${stamp}`;
    let token = '';
    let sharedGroupId: string | undefined;
    let privateGroupId: string | undefined;

    const contextB = await browser.newContext({ storageState: undefined, baseURL });
    const pageB = await contextB.newPage();
    try {
      await page.goto(CHAT, { timeout: 30000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      token = await accessToken(page);

      sharedGroupId = await createPrompt(page, token, sharedName);
      privateGroupId = await createPrompt(page, token, privateName);

      /* B is registered before the grant. Registering wipes and recreates the
       * account when it already exists, which would throw away access granted
       * to the previous one. */
      await ensureSecondaryUser(browser, pageB, getSecondaryE2EUser(), baseURL);

      await page.goto(`/prompts/${sharedGroupId}`, { timeout: 20000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();

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
      /* The dialog stays open after saving — measured, not assumed; the first
       * version of this test expected it to close and failed on a save that had
       * in fact gone through. What the app does say is a toast, so that is what
       * "it landed" is read from. */
      /* Exact, because the toast is announced twice: once as the visible
       * message and once inside a `role="status"` live region that reads
       * "Notification " first. A loose match resolves to both and the run dies
       * of strict mode — which it did, on one repeat out of twelve. */
      await expect(
        page.getByText('Permissions updated successfully', { exact: true }),
      ).toBeVisible({ timeout: 15000 });

      await pageB.goto(CHAT, { timeout: 20000 });
      const filter = await openPromptsPanel(pageB);

      await filter.fill(sharedName, { timeout: 15000 });
      await expect(promptCard(pageB, sharedName)).toBeVisible({ timeout: 20000 });

      /* The control. Same panel, same field, same person — the only difference
       * is that this one was never shared.
       *
       * The empty state comes first on purpose. `toHaveCount(0)` on its own is
       * satisfied while the refiltered list is still in flight, so it needs a
       * settled state to stand on; putting it second also means a real failure
       * reports the card that should not be there rather than the empty state
       * that is missing. */
      await filter.fill(privateName, { timeout: 15000 });
      await expect(pageB.getByText('No prompts yet', { exact: false })).toBeVisible({
        timeout: 15000,
      });
      await expect(promptCard(pageB, privateName)).toHaveCount(0);
    } finally {
      await contextB.close();
      await deletePrompt(page, token, sharedGroupId);
      await deletePrompt(page, token, privateGroupId);
    }
  });
});
