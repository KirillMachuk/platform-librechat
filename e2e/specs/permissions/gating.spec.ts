import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Role permissions decide what the interface offers, and until now only the
 * server half of that was tested: `e2e/specs/mock/permissions.spec.ts` proves
 * the API enforces them and never looks at a screen.
 *
 * This runs against `e2e/config/librechat.permissions.yaml`, which switches two
 * permissions off, leaves the rest on, and turns on the sharing permissions the
 * deployment has not enabled yet. Why a whole second profile
 * rather than flipping a permission inside the existing one: self-service
 * registration in this fork always creates a plain USER, so no test can grant
 * itself `MANAGE_ROLES` and call the roles API, and roles are cached
 * server-side, so writing to Mongo behind the server's back changes nothing a
 * page can see. The config is the lever an operator actually pulls.
 *
 * Every assertion comes in a pair. The permissions the run switched OFF must
 * take their affordance with them; the ones left ON must keep theirs. Without
 * the second half, a run where the whole permission system failed to load —
 * or where the sidebar simply did not render — would look exactly like a run
 * where every gate worked.
 */
const CHAT = '/c/new';

/** The role as the server actually seeded it, not as the config file reads. */
async function permissions(page: Page): Promise<Record<string, Record<string, boolean>>> {
  return page.evaluate(async () => {
    const refresh = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const { token } = (await refresh.json()) as { token?: string };
    const response = await fetch('/api/roles/USER', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    const role = (await response.json()) as {
      permissions?: Record<string, Record<string, boolean>>;
    };
    return role.permissions ?? {};
  });
}

test.describe('role permissions gate the interface', () => {
  test('the config seeded the role exactly as written', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(CHAT, { timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    /* Read before asserting on any button. If the seeding never happened, the
     * missing controls below would prove nothing about gating — and this is the
     * assertion that says which of the two worlds the run is in. */
    const seeded = await permissions(page);
    expect(seeded.MULTI_CONVO?.USE).toBe(false);
    expect(seeded.TEMPORARY_CHAT?.USE).toBe(false);
    expect(seeded.AGENTS?.USE).toBe(true);
    expect(seeded.SKILLS?.USE).toBe(true);

    /* The sharing half of this profile. These are off in the deployment today,
     * not by choice but because `prompts: true` never reaches them — the
     * seeding reads `share`/`public` only from an object. Written down as an
     * assertion so the day the config shape changes, this says so. */
    expect(seeded.PROMPTS?.SHARE).toBe(true);
    expect(seeded.PROMPTS?.SHARE_PUBLIC).toBe(true);
    expect(seeded.AGENTS?.SHARE).toBe(true);
    expect(seeded.SKILLS?.SHARE).toBe(true);

    /* The rest of the family, switched on the same way and for the same reason.
     * Each of these was `false` on a fresh database until this config named it —
     * measured, not assumed. */
    expect(seeded.MARKETPLACE?.USE).toBe(true);
    expect(seeded.MCP_SERVERS?.CREATE).toBe(true);
    expect(seeded.MCP_SERVERS?.CONFIGURE_OBO).toBe(true);
    expect(seeded.REMOTE_AGENTS?.USE).toBe(true);
    expect(seeded.REMOTE_AGENTS?.SHARE).toBe(true);
    /* The one that mints a long-lived key reaching agents outside the browser
     * session. `remote-agent-keys.spec.ts` walks that flow; this line is what
     * says the profile it walks in really has the permission on. */
    expect(seeded.REMOTE_AGENTS?.CREATE).toBe(true);

    /* And off, on purpose. Sharing with a named person needs the people picker;
     * sharing with everyone does not, and everyone-sharing is all this
     * deployment wants (owner, 2026-08-06). The permission opens the whole staff
     * directory to every USER through `search-principals`, so leaving it off is
     * a decision — and this line is what keeps it one rather than an oversight
     * somebody switches on while adding an unrelated key. */
    expect(seeded.PEOPLE_PICKER?.VIEW_USERS).toBe(false);

    /* And the object form must not have quietly taken USE and CREATE with it,
     * which is what would happen if the seeding treated an object as "only what
     * is listed". Measured: it does not. */
    expect(seeded.PROMPTS?.USE).toBe(true);
    expect(seeded.PROMPTS?.CREATE).toBe(true);
  });

  test('a permission switched off takes its control with it', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(CHAT, { timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    /* Both controls below live in the chat header, so the control for them has
     * to live there too — the sidebar links asserted in the next test would
     * still be present on a build where the header lost its whole toolbar. The
     * model selector is the neighbour that no permission gates.
     *
     * Not the export menu, which was the first choice and does not render at
     * all on a new chat: it hides itself while the conversation id is still
     * "new". Measured, three runs red, before this settled on the selector. */
    await expect(page.getByTestId('model-selector-trigger').first()).toBeVisible();

    /* And a control that DOES depend on a permission, in this same test. The
     * selector above proves the header rendered, but it renders whether or not
     * the roles request has come back — and `useHasAccess` answers "no" while
     * that request is in flight, so both negatives below would pass on a run
     * where the roles simply had not arrived. A review caught that. This link
     * appears only with `PROMPTS.USE`, which this profile leaves on, so it is
     * the signal that the permission answer is in. */
    await expect(page.getByTestId('sidebar-link-prompts')).toHaveCount(1);

    await expect(page.getByTestId('add-multi-convo-button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Temporary Chat' })).toHaveCount(0);
  });

  test('the permissions left on keep their controls', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(CHAT, { timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    /* The other half of every pair above. These render from the same sidebar,
     * through the same hook, on the same screen — so if they are here and the
     * two above are not, the difference is the permission and nothing else. */
    await expect(page.getByTestId('sidebar-link-agents')).toHaveCount(1);
    await expect(page.getByTestId('sidebar-link-skills')).toHaveCount(1);
    await expect(page.getByTestId('sidebar-link-prompts')).toHaveCount(1);

    /* The MCP builder's entry. Note what this does NOT say: it is not evidence
     * about `mcpServers.create`. `useSideNavLinks` renders this link when
     * (`MCP_SERVERS.USE` and at least one server is configured) OR `CREATE`, and
     * this profile satisfies the first half on its own — it defines the
     * `e2e-memory` server and USE is a role default. Measured: switching
     * `create` off leaves this assertion green. An earlier version of this
     * comment claimed the opposite and an independent review caught it. */
    await expect(page.getByTestId('sidebar-link-mcp-builder')).toHaveCount(1);
  });
});
