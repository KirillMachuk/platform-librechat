import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MOCK_ENDPOINTS, mockReply, selectMockEndpoint, sendMessage } from './helpers';

/**
 * The 1ma fork manages projects through a sidebar popup (not upstream's
 * `/projects` page): the "Projects" nav button opens the panel, "New project"
 * opens a create dialog, and creating switches the panel to the project's
 * detail view. A project-scoped chat lives at `/projects/:id/c/:id`.
 */
async function openProjectsPanel(page: Page) {
  await page.goto('/c/new', { timeout: 10000 });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible();
}

/** Create a project from the popup and return its id (from the create response). */
async function createProject(page: Page, name: string): Promise<string> {
  await openProjectsPanel(page);
  await page.getByRole('button', { name: 'New project' }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('#project-name').fill(name);
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/projects' &&
        response.ok(),
      { timeout: 30000 },
    ),
    dialog.getByRole('button', { name: 'Create', exact: true }).click(),
  ]);
  const project = (await createResponse.json()) as { projectId: string };
  expect(project.projectId).toBeTruthy();

  // Creating switches the popup to the project's detail view (heading = name).
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  return project.projectId;
}

const uniqueName = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.describe('chat projects', () => {
  test('creates a project via the popup and lists it', async ({ page }) => {
    test.setTimeout(60000);
    const name = uniqueName('E2E Project');

    await createProject(page, name);

    // Reopen the panel; the new project is listed.
    await openProjectsPanel(page);
    await expect(page.getByRole('button', { name }).first()).toBeVisible();
  });

  test('starts a project-scoped chat and persists it under the project', async ({ page }) => {
    test.setTimeout(120000);
    const name = uniqueName('E2E Project');
    const projectId = await createProject(page, name);

    // Start a chat inside the project from the detail view.
    await page
      .getByRole('button', { name: `New chat in ${name}` })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/c/new`), { timeout: 15000 });

    // The composer scopes the chat; switch to a mock endpoint and send.
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    const response = await sendMessage(page, 'hello from a project');
    expect(response.ok()).toBeTruthy();
    await expect(mockReply(page)).toBeVisible({ timeout: 20000 });

    // The new chat is created project-scoped (URL carries the project prefix).
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/c/(?!new)`), {
      timeout: 15000,
    });
    const conversationId = page.url().split('/c/')[1];
    expect(conversationId).toBeTruthy();

    // On reload the fork canonicalizes to /c/:id but keeps the same conversation.
    await page.reload({ timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/c/${conversationId}$`), { timeout: 15000 });
    await expect(mockReply(page)).toBeVisible({ timeout: 20000 });
  });
});
