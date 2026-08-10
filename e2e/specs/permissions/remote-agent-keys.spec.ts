import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAccountMenu } from '../mock/helpers';

/**
 * `REMOTE_AGENTS.CREATE` — the permission that mints a long-lived key reaching
 * agents from outside the browser session — was on in this profile and
 * exercised by nothing. It is also not where its name suggests: the "Remote
 * Access" button in the agent builder is `REMOTE_AGENTS.SHARE`, a grant-access
 * dialog that never mints anything. Minting lives in Settings → Data controls
 * → Agent API Keys.
 *
 * The server-side half is already proven by supertest
 * (`api/server/routes/__tests__/apiKeys.createGate.test.js`: USE without
 * CREATE is 403, USE+CREATE is 201). What nothing proved is the part a person
 * actually does, and the promise the screen makes while they do it: the key is
 * shown once, in full, and never again. That promise is only worth anything if
 * the list really cannot hand it back — so this checks both ends, the response
 * that carries the secret and the listing that must not.
 *
 * Deliberately not claimed: this does not prove CREATE gates the button. The
 * profile has the permission on and there is no second profile to turn it off
 * against, so the gate is read from `AgentApiKeys.tsx`, not measured here.
 */
const CHAT = '/c/new';

type CreatedKey = { id?: string; key?: string; keyPrefix?: string; name?: string };
type ListedKey = { id?: string; name?: string; keyPrefix?: string; key?: string };

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

/**
 * `/api/api-keys`, not `/api/keys` — the latter is a different router
 * altogether (per-user provider credentials, covered by `keys.spec.ts`). A
 * predicate matching the shorter path would simply never fire.
 */
async function listKeys(page: Page, token: string): Promise<ListedKey[]> {
  return page.evaluate(async (authToken) => {
    const response = await fetch('/api/api-keys', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    /* `TAgentApiKeyListResponse` — `{ keys: [...] }`, and each entry is a
     * `TAgentApiKeyListItem`, whose type has no `key` field at all. */
    return ((await response.json()) as { keys?: ListedKey[] }).keys ?? [];
  }, token);
}

async function deleteKey(page: Page, token: string, id: string | undefined) {
  if (!id) {
    return;
  }
  await page
    .evaluate(
      async ({ authToken, keyId }) => {
        await fetch(`/api/api-keys/${keyId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      },
      { authToken: token, keyId: id },
    )
    .catch(() => undefined);
}

test.describe('minting a key for a remote agent', () => {
  test('the key is shown once on creation, and the list can never hand it back', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const name = `E2E Remote Key ${Date.now()}`;
    let token = '';
    let createdId: string | undefined;

    try {
      await page.goto(CHAT, { timeout: 30000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      token = await accessToken(page);

      const menu = await openAccountMenu(page);
      await menu.getByRole('menuitem', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible({
        timeout: 15000,
      });
      await page.getByRole('tab', { name: 'Data controls' }).click();

      /* The trigger takes its accessible name from the row's label through
       * `aria-labelledby`, so it answers to "Agent API Keys" rather than to
       * its own visible word, "Manage". */
      await page.getByRole('button', { name: 'Agent API Keys' }).click();
      await expect(page.getByText('No API keys yet. Create one to get started.')).toBeVisible({
        timeout: 15000,
      });

      await page.getByRole('button', { name: 'Create API Key' }).click();
      await page.locator('#key-name').fill(name);

      const minted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/api-keys' &&
          response.request().method() === 'POST',
        { timeout: 30000 },
      );
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      const mintedResponse = await minted;
      expect(mintedResponse.status()).toBe(201);

      const created = (await mintedResponse.json()) as CreatedKey;
      createdId = created.id;
      expect(created.name).toBe(name);
      /* The secret itself, and only here. */
      expect(created.key, 'creation must return the raw key').toMatch(/^sk-/);
      expect(created.keyPrefix).toBe(created.key?.slice(0, 8));

      /* The screen says so out loud — the warning is the whole reason the
       * assertion below matters to a person. */
      await expect(
        page.getByText("Make sure to copy your API key now. You won't be able to see it again!"),
      ).toBeVisible({ timeout: 15000 });
      /* Read by label, not by role: the field is `type="password"` until the
       * reveal toggle is used, and a password input has no textbox role. */
      await expect(page.getByLabel('Your API Key')).toHaveValue(created.key ?? '');

      await page.getByRole('button', { name: 'Done' }).click();

      /* And the half that makes "you won't see it again" true rather than
       * decorative: the listing carries the prefix so a person can tell their
       * keys apart, and carries no way to recover the secret. Read straight
       * from the API — the screen could be hiding it while the payload
       * still shipped it to the browser. */
      const listed = await listKeys(page, token);
      const mine = listed.find((entry) => entry.id === createdId);
      expect(mine, 'the key must be in the list after creation').toBeTruthy();
      expect(mine?.keyPrefix).toBe(created.keyPrefix);

      /* Named fields rather than a substring hunt for the raw key. The key
       * itself is never stored — only a SHA-256 of it — so the leak this
       * could actually spring is the hash, and searching the payload for the
       * plaintext would sail straight past it. Both names are asserted, and
       * the field list is pinned whole so a new secret-bearing field added
       * upstream has to come through here. */
      expect(mine?.key, 'the listing must not carry the secret').toBeUndefined();
      expect(
        (mine as Record<string, unknown> | undefined)?.keyHash,
        'nor the hash of it',
      ).toBeUndefined();
      expect(Object.keys(mine ?? {}).sort()).toEqual(
        ['createdAt', 'expiresAt', 'id', 'keyPrefix', 'name'].sort(),
      );

      /* The person sees the key they just made, by name and by prefix. */
      await expect(page.getByText(name)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(`${created.keyPrefix}...`)).toBeVisible();
    } finally {
      await deleteKey(page, token, createdId);
    }
  });
});
