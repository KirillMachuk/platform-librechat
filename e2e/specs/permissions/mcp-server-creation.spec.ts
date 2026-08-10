import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * `MCP_SERVERS.CREATE` and `MCP_SERVERS.CONFIGURE_OBO` were on in this profile
 * and exercised by nothing — `mcp.spec.ts` only attaches the pre-configured
 * `e2e-memory` fixture to an agent, never opens the MCP builder's own "Add
 * MCP" dialog. Both are gates the owner is waiting on before deciding whether
 * to turn them on for the deployment itself.
 *
 * On-Behalf-Of auth is the one half of this that a hermetic profile can prove
 * end to end today: `MCPServerInspector.inspect()` skips the entire live
 * connection / `listTools()` step whenever the config carries `obo`, so an
 * OBO server saves without this suite needing a reachable MCP endpoint of its
 * own. A plain server does not get that exemption — it genuinely tries to
 * connect, and an unreachable one gives a real, deterministic
 * `MCP_INSPECTION_FAILED`. That contrast is the test: same panel, same form,
 * same unreachable-by-construction URL shape, and only the auth type decides
 * whether creation succeeds.
 *
 * URLs use the `.invalid` TLD (RFC 2606 — reserved to always fail to
 * resolve), which is not `localhost`, not a private IP, and not on the
 * SSRF domain blocklist, so it clears the synchronous domain check that runs
 * before either code path and fails for the same reason a real dead server
 * would.
 */
const CHAT = '/c/new';

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
 * Keyed by server name, not wrapped and not an array —
 * `getMCPServersList` returns `redactAllServerSecrets(serverConfigs, ...)`
 * verbatim, and each value is the config itself (`obo` sits at the top
 * level, not under a nested `.config`).
 */
async function fetchServers(
  page: Page,
  token: string,
): Promise<Record<string, { obo?: { scopes?: string } }>> {
  return page.evaluate(async (authToken) => {
    const response = await fetch('/api/mcp/servers', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return (await response.json()) as Record<string, { obo?: { scopes?: string } }>;
  }, token);
}

async function deleteServer(page: Page, token: string, serverName: string | undefined) {
  if (!serverName) {
    return;
  }
  await page
    .evaluate(
      async ({ authToken, name }) => {
        await fetch(`/api/mcp/servers/${name}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      },
      { authToken: token, name: serverName },
    )
    .catch(() => undefined);
}

async function openCreateDialog(page: Page) {
  /* The MCP Settings link opens `UnifiedSidebar/PanelDialog` — a modal in its
   * own right, covering the sidebar underneath — and it stays open across
   * both creation attempts in this test. Clicking the sidebar link a second
   * time would just hit that still-open panel's own backdrop, so only reach
   * for it when the panel genuinely isn't up yet. */
  const addButton = page.getByRole('button', { name: 'Add MCP' });
  if (!(await addButton.isVisible().catch(() => false))) {
    if ((await page.getByTestId('sidebar-link-mcp-builder').count()) === 0) {
      await page.getByTestId('sidebar-link-more').click();
    }
    await page.getByTestId('sidebar-link-mcp-builder').click();
    await expect(addButton).toBeVisible({ timeout: 15000 });
  }
  await addButton.click();
  await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('creating an MCP server', () => {
  test('On-Behalf-Of auth saves without a live connection; a server without it does not', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const stamp = `${Date.now()}`;
    let token = '';
    let createdServerName: string | undefined;

    try {
      await page.goto(CHAT, { timeout: 30000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
      token = await accessToken(page);

      // --- OBO: the auth type that skips the live-connection check ---
      await openCreateDialog(page);
      await page.locator('#mcp-title').fill(`E2E OBO Server ${stamp}`);
      await page.locator('#url').fill(`https://mcp-e2e-obo-${stamp}.invalid/sse`);
      await page.getByRole('radio', { name: 'On-Behalf-Of (OBO)' }).click();
      await page.locator('#obo_scopes').fill(`api://e2e-${stamp}/Mcp.Tools.ReadWrite`);
      await page.locator('#trust').click();

      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/mcp/servers') && response.request().method() === 'POST',
        { timeout: 30000 },
      );
      await page.getByRole('button', { name: 'Create MCP server' }).click();
      const createdResponse = await created;
      expect(createdResponse.ok(), 'OBO creation should not need a reachable server').toBeTruthy();
      const createdBody = (await createdResponse.json()) as { serverName?: string };
      createdServerName = createdBody.serverName;
      expect(createdServerName).toBeTruthy();

      await expect(page.getByText('MCP server created successfully', { exact: true })).toBeVisible({
        timeout: 15000,
      });
      /* Success closes the dialog outright for OBO — only OAuth creation
       * detours through a second "here is your redirect URI" dialog. */
      await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toHaveCount(0);

      /* Not just the toast: the server actually persisted with its OBO
       * config, read back independently of the create response. */
      const servers = await fetchServers(page, token);
      expect(servers[createdServerName as string]?.obo?.scopes).toBe(
        `api://e2e-${stamp}/Mcp.Tools.ReadWrite`,
      );

      // --- No auth, same unreachable-by-construction URL shape: must fail ---
      await openCreateDialog(page);
      await page.locator('#mcp-title').fill(`E2E No Auth Server ${stamp}`);
      await page.locator('#url').fill(`https://mcp-e2e-noauth-${stamp}.invalid/sse`);
      await page.locator('#trust').click();

      const rejected = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/mcp/servers') && response.request().method() === 'POST',
        { timeout: 30000 },
      );
      await page.getByRole('button', { name: 'Create MCP server' }).click();
      const rejectedResponse = await rejected;
      expect(rejectedResponse.ok(), 'an unreachable non-OBO server should be refused').toBeFalsy();

      /* Exact: the toast is announced twice, once visibly and once in a
       * `role="status"` live region that reads "Notification " first. */
      await expect(
        page.getByText(
          'Connection attempt to the provided MCP server failed. Please make sure the URL, the server type, and any authentication configuration are correct, then try again. Also ensure the URL is reachable.',
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15000 });
      /* Failure leaves the dialog open — nothing to reset it back to closed. */
      await expect(page.getByRole('heading', { name: 'Add MCP Server' })).toBeVisible();

      const serversAfterFailure = await fetchServers(page, token);
      expect(
        Object.keys(serversAfterFailure).some((name) => name.includes('noauth')),
        'the rejected server must not have been saved under any name',
      ).toBeFalsy();
    } finally {
      await deleteServer(page, token, createdServerName);
    }
  });
});
