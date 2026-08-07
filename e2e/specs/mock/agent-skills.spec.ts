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
 * them, and joining them turned up a defect.
 *
 * **A DEPLOYMENT skill picked in the builder is dropped on save.** The browser
 * sends `{"skills":["<id>"],"skills_enabled":true}` and the create response is
 * `{"skills":[],"skills_enabled":false}` — the switch goes off with it, and
 * `packages/api/src/agents/skills.ts` then hands the agent no skills at all.
 *
 * Why, established rather than guessed: a deployment skill's id is synthetic.
 * `packages/api/src/skills/deployment.ts` builds it as
 * `stableObjectId('deployment-skill:<name>')` — a truncated hash — and keeps
 * the skill in memory; it is never written to the `Skill` collection. The
 * catalogue at `GET /api/skills` serves that id anyway, and so does the picker,
 * but `filterExistingSkillIds` (`packages/data-schemas/src/methods/skill.ts`)
 * checks Mongo and only Mongo. Nothing matches, the allowlist empties, and
 * `createAgent` deliberately fails closed — an empty allowlist with the switch
 * on would mean "the whole catalogue", so it turns the switch off instead.
 *
 * So this is a disagreement between the catalogue and the existence check, not
 * a server that loses valid skills. The second test below measures exactly that
 * boundary: a skill created through `POST /api/skills` — a real Mongo document
 * — survives the same path untouched. An earlier version of this file said the
 * server "stores neither the skill nor the switch" full stop, which overstated
 * it; an independent review caught that and the contrast is now asserted rather
 * than described.
 *
 * The pair is the repo's pinning shape. `test.fail` states what should happen;
 * because `test.fail` passes on ANY error, including a broken fixture, the
 * sibling pins exactly what is true today and is the one that turns red on the
 * day this is fixed.
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

      /* The id the browser sent is one the server itself serves — the first
       * thing anyone reading this defect will suspect is a stale or invented
       * identifier, and it is neither. */
      const token = await getAccessToken(page);
      const catalogue = await requestJson<{ skills?: { _id: string; name: string }[] }>(page, {
        path: '/api/skills?limit=50',
        token,
      });
      const picked = (catalogue.skills ?? []).find((skill) => skill._id === sent.skills?.[0]);
      expect(picked?.name).toBe(DEPLOYMENT_SKILL);

      /* And the boundary, which is the whole point of this test rather than a
       * flourish: a skill that IS a Mongo document goes through the same
       * endpoint and survives. Without this the file reads as "agents cannot
       * keep skills", which is not true and would send whoever fixes this
       * looking in the wrong place. */
      const ownSkillName = `e2e-agent-skill-boundary-${Date.now()}`;
      const boundary = await page.evaluate(
        async ({ authToken, skillName }) => {
          const made = await fetch('/api/skills', {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: skillName,
              description: 'Fixture proving a database-backed skill is kept.',
              body: '# boundary\n\nSteps.',
            }),
          });
          const skill = (await made.json()) as { _id?: string };
          const agent = await fetch('/api/agents', {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `E2E Boundary Agent ${skillName}`,
              provider: 'Mock Provider A',
              model: 'mock-model-a',
              category: 'general',
              skills: [skill._id],
              skills_enabled: true,
            }),
          });
          const created = (await agent.json()) as {
            id?: string;
            skills?: string[];
            skills_enabled?: boolean;
          };
          if (created.id) {
            await fetch(`/api/agents/${created.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${authToken}` },
            });
          }
          if (skill._id) {
            await fetch(`/api/skills/${skill._id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${authToken}` },
            });
          }
          return { stored: created.skills ?? [], enabled: created.skills_enabled, id: skill._id };
        },
        { authToken: token, skillName: ownSkillName },
      );
      expect(boundary.stored).toEqual([boundary.id]);
      expect(boundary.enabled).toBe(true);
    } finally {
      if (agentId) {
        await cleanupAgent(page, agentId);
      }
    }
  });
});
