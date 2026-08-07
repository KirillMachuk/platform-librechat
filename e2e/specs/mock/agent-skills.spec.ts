import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cleanupAgent, openAgentBuilder, selectMockModel, uniqueAgentName } from './agents.helpers';
import { getAccessToken, requestJson } from './helpers';

/**
 * Attaching a skill to an agent, which is the point of having both.
 *
 * Skills were covered on their own — the API loads and scopes them
 * (`deployment-skills.spec.ts`), the interface lists and opens them
 * (`skills.spec.ts`) — and agents were covered on their own. Nothing joined
 * them, and joining them turned up a defect: the picker offers the skill, the
 * form sends it, and the server stores neither it nor the switch beside it.
 *
 * Measured on 2026-08-07 rather than inferred. The browser sends
 * `{"skills":["<the skill's real id>"],"skills_enabled":true}` and the create
 * response comes back `{"skills":[],"skills_enabled":false}`. The id is right —
 * `GET /api/skills` in the same run lists that exact id — and a `PATCH` with it
 * afterwards answers 200 and stores nothing either, by id or by name. The
 * response is not sanitised on this path: the viewer-scope sanitiser runs only
 * on the LIST endpoint, and this reads the created document straight back.
 *
 * So the two tests below are the repo's pinning pair. `test.fail` states what
 * should happen; because `test.fail` passes on ANY error, including a broken
 * fixture, the sibling pins exactly what is wrong today and is the one that
 * turns red on the day this is fixed.
 */
const DEPLOYMENT_SKILL = 'e2e-deployment-skill';

type AgentWithSkills = { id?: string; skills?: string[]; skills_enabled?: boolean };

async function persistedAgent(page: Page, id: string): Promise<AgentWithSkills> {
  const token = await getAccessToken(page);
  return requestJson<AgentWithSkills>(page, { path: `/api/agents/${id}`, token });
}

/**
 * Builds an agent with the deployment skill picked, and answers with both what
 * the browser sent and what came back — the pair that makes the defect a
 * statement about the server rather than about the click.
 */
async function createAgentWithSkill(page: Page, form: Locator, agentName: string) {
  await form.getByLabel('Agent name').fill(agentName);
  /* `true`: the model picker opens a panel of its own over the builder, and
   * without coming back the skills section is not on screen at all — which is
   * how the first version of this failed, looking for a switch one view away. */
  await selectMockModel(page, true);

  /* The Add Skills button is disabled until this switch is on, so it is not
   * decoration: without it the click below does nothing. */
  const skillsSwitch = form.getByTestId('skills_enabled');
  await expect(skillsSwitch).toBeVisible();
  if ((await skillsSwitch.getAttribute('aria-checked')) !== 'true') {
    await skillsSwitch.click();
  }

  const addSkills = form.getByRole('button', { name: 'Add Skills', exact: true });
  await expect(addSkills).toBeEnabled();
  await addSkills.click();

  /* Located by something only the picker has. Filtering on the words "Add
   * Skills" matches the agents panel behind it too — the panel holds the button
   * that opened this — and the run dies of strict mode. */
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByPlaceholder('Search skills...') });
  await expect(dialog).toBeVisible();
  await dialog.getByText(DEPLOYMENT_SKILL, { exact: true }).first().click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/agents' &&
      response.request().method() === 'POST' &&
      response.ok(),
    { timeout: 30000 },
  );
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await created;
  const sent = JSON.parse(response.request().postData() ?? '{}') as AgentWithSkills;
  const returned = (await response.json()) as AgentWithSkills;
  return { sent, returned };
}

test.describe('skills on an agent', () => {
  test.fail(
    'a skill picked in the builder is still on the agent after saving',
    async ({ page }) => {
      test.setTimeout(180000);
      const agentName = uniqueAgentName('E2E Skill Agent');
      let agentId = '';

      try {
        const form = await openAgentBuilder(page);
        const { returned } = await createAgentWithSkill(page, form, agentName);
        agentId = returned.id ?? '';
        expect(agentId, 'the agent should come back with an id').toBeTruthy();

        const saved = await persistedAgent(page, agentId);
        expect(saved.skills_enabled).toBe(true);
        expect(saved.skills).toHaveLength(1);
      } finally {
        if (agentId) {
          await cleanupAgent(page, agentId);
        }
      }
    },
  );

  /**
   * The sibling. It asserts today's wrong outcome AND the half that is right,
   * so a failure here separates the two: if the browser stops sending the
   * skill, that is a new defect in the interface; if the server starts keeping
   * it, this goes red and the pin above becomes the real test.
   */
  test('today the skill is sent and then dropped on save', async ({ page }) => {
    test.setTimeout(180000);
    const agentName = uniqueAgentName('E2E Skill Agent');
    let agentId = '';

    try {
      const form = await openAgentBuilder(page);
      const { sent, returned } = await createAgentWithSkill(page, form, agentName);
      agentId = returned.id ?? '';

      /* The interface half, which works: one skill picked, one skill sent, and
       * the switch beside it sent on. */
      expect(sent.skills_enabled).toBe(true);
      expect(sent.skills).toHaveLength(1);

      /* And the server half, which does not. */
      expect(returned.skills ?? []).toEqual([]);
      expect(returned.skills_enabled).toBe(false);

      /* The id the browser sent is a real skill, listed by the same server in
       * the same run — so this is not a stale or invented identifier, which is
       * the first thing anyone reading this defect will suspect. */
      const token = await getAccessToken(page);
      const catalogue = await requestJson<{ skills?: { _id: string; name: string }[] }>(page, {
        path: '/api/skills?limit=50',
        token,
      });
      const picked = (catalogue.skills ?? []).find((skill) => skill._id === sent.skills?.[0]);
      expect(picked?.name).toBe(DEPLOYMENT_SKILL);
    } finally {
      if (agentId) {
        await cleanupAgent(page, agentId);
      }
    }
  });
});
