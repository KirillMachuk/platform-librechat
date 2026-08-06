import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { NEW_CHAT_PATH } from './helpers';

/**
 * Skills as a person meets them, which until now nothing covered.
 *
 * `deployment-skills.spec.ts` and `model-spec-skills.spec.ts` prove the API
 * loads, scopes and protects configured skills; both talk to `/api/skills` and
 * never open a screen. So a build where the panel failed to render, or where
 * clicking a skill led nowhere, was green.
 *
 * The two tests here are a pair on purpose. The first says a deployment skill
 * offers no Edit; on its own that assertion also passes on a build where Edit
 * never renders for anything. The second creates a skill of the reader's own on
 * the same screen through the same component, and requires Edit to be there.
 * Only together do they say the difference is ownership.
 */
const DEPLOYMENT_SKILL = 'e2e-deployment-skill';
const DEPLOYMENT_SKILL_BODY = 'E2E deployment skill loaded through Playwright';
const DEPLOYMENT_SKILL_FILE = 'guide.txt';
const OWN_SKILL = 'e2e-own-skill';
const OWN_SKILL_DESCRIPTION = 'A skill created through the interface by the e2e run.';

/**
 * The panel is a Headless UI dialog whose own element has no box, so it never
 * counts as visible — the heading is what says it opened. Same shape as
 * `openFilesPanel` in `files.helpers.ts`, kept local because the two panels
 * share nothing but that quirk.
 *
 * Two headings read "Skills" inside it: the dialog's own title and the panel's,
 * which is why this settles for the first rather than pretending there is one.
 */
async function openSkillsPanel(page: Page): Promise<Locator> {
  const panel = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Skills' }) });
  await page.getByTestId('sidebar-link-skills').click();
  await expect(panel.getByRole('heading', { name: 'Skills' }).first()).toBeVisible();
  return panel;
}

async function onChatScreen(page: Page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
}

test.describe('skills in the interface', () => {
  test('a configured skill is listed, its files open, and it stays read-only', async ({ page }) => {
    test.setTimeout(120000);
    await onChatScreen(page);

    const panel = await openSkillsPanel(page);
    const row = panel.getByText(DEPLOYMENT_SKILL, { exact: true });
    await expect(row).toBeVisible();

    /* The file list is not merely hidden while collapsed — it is not fetched.
     * That makes "absent, then present" a statement about the click doing
     * work, rather than about a CSS rule. */
    await expect(panel.getByRole('button', { name: DEPLOYMENT_SKILL_FILE })).toHaveCount(0);
    /* Exact, because the row that contains this control takes its label into
     * its own accessible name and would match too. */
    await panel.getByRole('button', { name: 'Toggle files', exact: true }).click();
    await expect(panel.getByRole('button', { name: DEPLOYMENT_SKILL_FILE })).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(/\/skills\/[a-f0-9]{24}$/);
    await expect(page.getByText(DEPLOYMENT_SKILL_BODY)).toBeVisible();

    /* Positive control for the assertion below: the toolbar of the detail view
     * did render. Without it, "no Edit button" is also what an empty screen
     * looks like. */
    await expect(page.getByRole('button', { name: 'View source' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('a skill of my own is mine to edit', async ({ page }) => {
    test.setTimeout(150000);
    await onChatScreen(page);

    const panel = await openSkillsPanel(page);
    /* By label, not by role: the control is a `<button>` element but Ariakit
     * gives it the combobox role, so `getByRole('button')` walks past it. */
    await panel.getByLabel('Create Skill', { exact: true }).click();
    await page.getByRole('option', { name: 'Write skill instructions' }).click();

    await page.locator('#create-skill-name').fill(OWN_SKILL);
    await page.locator('#create-skill-body').fill('Steps the agent should follow.');
    await page.getByLabel('Description', { exact: true }).fill(OWN_SKILL_DESCRIPTION);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/skills') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await created;

    /* Creating lands on the new skill's own page. */
    await expect(page).toHaveURL(/\/skills\/[a-f0-9]{24}$/);
    await expect(page.getByText(OWN_SKILL, { exact: true }).first()).toBeVisible();

    /* The other half of the pair: same screen, same component as the read-only
     * skill above, and here the Edit button is required to exist. */
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    /* Leave the shared database as it was found — the skills list is what the
     * first test reads. */
    await page.evaluate(async (name) => {
      const refresh = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const { token } = (await refresh.json()) as { token?: string };
      const headers = { Authorization: `Bearer ${token ?? ''}` };
      const list = (await (
        await fetch(`/api/skills?search=${encodeURIComponent(name)}&limit=10`, { headers })
      ).json()) as { skills?: { _id: string; name: string }[] };
      const mine = list.skills?.find((skill) => skill.name === name);
      if (mine) {
        await fetch(`/api/skills/${mine._id}`, { method: 'DELETE', headers });
      }
    }, OWN_SKILL);
  });
});
