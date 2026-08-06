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
    expect(seeded.PEOPLE_PICKER?.VIEW_USERS).toBe(true);

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
  });
});
