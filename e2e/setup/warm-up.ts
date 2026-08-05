import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';

/**
 * Send one throwaway message before any test runs, then delete the conversation
 * it made.
 *
 * The first streamed reply a cold server produces costs far more than every one
 * after it, and whichever spec happens to go first pays for it — against the
 * 10s default `expect` timeout. Measured on this main: `model-switching.spec.ts`
 * fails one run in three with "element(s) not found, Timeout: 10000ms", always
 * on the first message. `chat.spec.ts` had the same flake until its first
 * assertion was given an explicit 30s; that fixed one spec and left the class.
 * The redesign agent's own screenshot runner burns a message for the same
 * reason, and found the same thing independently.
 *
 * Raising every timeout instead would have hidden the cost rather than paid it,
 * and made each genuine failure three times slower to report.
 *
 * Deliberately forgiving: a warm-up that throws would take the whole suite down
 * over a step no test depends on. If it fails, the run continues exactly as it
 * did before this file existed.
 */
const WARM_UP_PROMPT = 'E2E_REPLY:warm-up';
const WARM_UP_REPLY = /E2E reply warm-up/;

export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3080';
  const storageState = config.projects[0]?.use?.storageState as string | undefined;
  if (!storageState) {
    return;
  }
  const browser = await chromium.launch({
    channel: process.env.E2E_CHROMIUM_CHANNEL || undefined,
  });
  try {
    const page = await browser.newPage({ storageState, baseURL });
    await page.goto('/c/new', { timeout: 30000 });
    const input = page.getByRole('textbox', { name: 'Message input' });
    await input.waitFor({ timeout: 30000 });
    await input.fill(WARM_UP_PROMPT);
    await input.press('Enter');
    await page.getByText(WARM_UP_REPLY).first().waitFor({ timeout: 90000 });

    /* Removed, not left behind: a conversation in the sidebar is a different
     * starting state, and three accessibility scans used to pass only because
     * nothing had created one yet. The access token lives in memory rather than
     * in a cookie, so it is fetched the way the app fetches it. */
    const deleted = await page.evaluate(async () => {
      const refresh = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const { token } = (await refresh.json()) as { token?: string };
      if (!token) {
        return false;
      }
      const response = await fetch('/api/convos/all', {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      return response.ok;
    });
    console.log(
      `🤖: ✔️  warm-up message answered${deleted ? ', conversation removed' : ' (cleanup skipped)'}`,
    );
  } catch (error) {
    console.log(`🤖: ⚠️  warm-up skipped: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}
