import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cleanupAgent, openAgentBuilder, selectMockModel, uniqueAgentName } from './agents.helpers';
import { getAccessToken, requestJson } from './helpers';

/**
 * Attaching a skill to an agent, which is the point of having both.
 *
 * Skills were covered on their own — the API loads and scopes them
 * (`deployment-skills.spec.ts`), the interface lists and opens them
 * (`skills.spec.ts`) — and agents were covered on their own. Joining them
 * turned up a defect that these two tests were written to pin and now guard.
 *
 * A deployment skill's id is synthetic: `packages/api/src/skills/deployment.ts`
 * builds it as `stableObjectId('deployment-skill:<name>')` and keeps the skill
 * in memory, never writing it to the `Skill` collection. The catalogue at
 * `GET /api/skills` serves that id anyway, and so does the picker, but
 * `filterExistingSkillIds` (`packages/data-schemas/src/methods/skill.ts`)
 * checked Mongo and only Mongo — so nothing matched, the allowlist emptied, and
 * `createAgent` failed closed and switched skills off, silently. The api layer
 * now declares such ids valid through `isExternalSkillId`.
 *
 * The two tests are the two classes of skill, and both must keep working: the
 * one that lives in a file and the one that lives in Mongo. Without the second,
 * a "fix" that simply stopped pruning would look right here while quietly
 * re-admitting the dangling ids the pruning exists to remove.
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
  test('a skill picked in the builder is still on the agent after saving', async ({ page }) => {
    test.setTimeout(180000);
    const agentName = uniqueAgentName('E2E Skill Agent');
    let agentId = '';

    try {
      const form = await openAgentBuilder(page);
      const { sent, returned } = await createAgentWithSkill(page, form, agentName);
      agentId = returned.id ?? '';
      expect(agentId, 'the agent should come back with an id').toBeTruthy();

      /* The interface half: one skill picked, one skill sent, switch on. */
      expect(sent.skills_enabled).toBe(true);
      expect(sent.skills).toHaveLength(1);

      /* Read back from the server rather than trusting the create response, so
       * this says "stored", not "echoed". */
      const saved = await persistedAgent(page, agentId);
      expect(saved.skills_enabled).toBe(true);
      expect(saved.skills).toEqual(sent.skills);

      /* And the id is one the catalogue itself serves — the first thing anyone
       * reading a skills defect suspects is a stale or invented identifier. */
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

  /**
   * The other class of skill: a real Mongo document. It went through this path
   * untouched even while deployment skills were being dropped, and it has to
   * keep doing so — a fix that simply stopped pruning would pass the test above
   * and quietly re-admit the dangling ids pruning exists to remove.
   */
  test('a skill that is a database document is kept too', async ({ page }) => {
    test.setTimeout(180000);
    await openAgentBuilder(page);
    const token = await getAccessToken(page);
    const ownSkillName = uniqueAgentName('e2e-agent-skill-boundary')
      .toLowerCase()
      .replace(/ /g, '-');

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
  });
});
