import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import type { User } from '../types';
import cleanupUser from './cleanupUser';

/**
 * A second person, for the tests whose whole claim is "someone else sees this"
 * or "someone else does not" — isolation, sharing.
 *
 * Every profile authenticates one user through `storageState`, so a second one
 * has to be registered from a clean context inside the test. Lives here rather
 * than in one spec because two profiles need it: the mock run for isolation,
 * the permissions run for sharing.
 */
async function register(page: Page, user: User) {
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Full name', { exact: true }).fill(user.name);
  await page.getByLabel('Email address', { exact: true }).fill(user.email);
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('confirm_password').fill(user.password);
  await page.getByTestId('registration-button').click();
}

async function registrationErrorIsVisible(page: Page) {
  return page
    .getByTestId('registration-error')
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

/**
 * Registers, and if the account is left over from an earlier run, deletes it
 * and registers again — so a test never inherits what the previous one did with
 * this user.
 */
export async function registerSecondaryUser(page: Page, user: User) {
  await page.goto('/', { timeout: 10000 });
  await page.waitForURL(/\/login/, { timeout: 10000 });
  await register(page, user);

  try {
    await page.waitForURL(/\/c\/new/, { timeout: 10000 });
  } catch (error) {
    if (!(await registrationErrorIsVisible(page))) {
      throw error;
    }

    await cleanupUser(user);
    await page.goto('/', { timeout: 10000 });
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await register(page, user);
    await page.waitForURL(/\/c\/new/, { timeout: 10000 });
  }
}

/** Register the secondary user in a throwaway context, then log in within `page`. */
export async function ensureSecondaryUser(
  browser: Browser,
  page: Page,
  user: User,
  baseURL: string,
) {
  const setupContext = await browser.newContext({ storageState: undefined, baseURL });
  const setupPage = await setupContext.newPage();
  try {
    await registerSecondaryUser(setupPage, user);
  } finally {
    await setupContext.close();
  }

  await page.goto('/login', { timeout: 10000 });
  await page.getByLabel('Email address', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByTestId('login-button').click();
  await page.waitForURL(/\/c\/new/, { timeout: 15000 });
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
}
