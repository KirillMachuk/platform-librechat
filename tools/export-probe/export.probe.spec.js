import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from '../../e2e/specs/mock/helpers';

/**
 * PROBE, not a regression test — deliberately outside `e2e/specs` so CI never runs
 * it and nothing mistakes it for coverage.
 *
 * Written for the owner's report that «Export conversation works only as png, the
 * other formats do nothing» (Safari, 26.08). It reports, per format, whether a
 * download actually starts and what the console said.
 *
 * Result so far: all five formats download in BOTH Chromium and WebKit, so neither
 * the export code nor the engine explains the report. What this probe CANNOT see is
 * real Safari's own download permission prompt — Playwright runs with
 * `acceptDownloads` and answers it silently. That is the remaining suspect.
 *
 *   npx playwright test --config=tools/export-probe/playwright.config.ts
 *   npx playwright test --config=tools/export-probe/playwright.config.ts --project=webkit
 */

const FORMATS = [
  { value: 'screenshot', label: 'screenshot (.png)' },
  { value: 'text', label: 'text (.txt)' },
  { value: 'markdown', label: 'markdown (.md)' },
  { value: 'json', label: 'json (.json)' },
  { value: 'csv', label: 'csv (.csv)' },
];

async function openChatWithOneTurn(page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
  const prompt = replyPrompt('export-probe');
  const response = await sendMessage(page, prompt);
  expect(response.ok()).toBeTruthy();
  await expect(messagesView(page).getByText(prompt)).toBeVisible({ timeout: 30000 });
  await expect(messagesView(page).getByText(replyText('export-probe'))).toBeVisible({
    timeout: 30000,
  });
}

test('probe: which export formats actually download', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      consoleErrors.push(`[${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

  await openChatWithOneTurn(page);

  const results = [];
  for (const format of FORMATS) {
    const before = consoleErrors.length;

    const menuTrigger = page.getByRole('button', { name: /Export|Share/i }).first();
    await expect(menuTrigger).toBeVisible({ timeout: 10000 });
    await menuTrigger.click();
    const exportItem = page.getByRole('menuitem', { name: /Export/i });
    await expect(exportItem).toBeVisible({ timeout: 10000 });
    await exportItem.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    if (format.value !== 'screenshot') {
      /* The modal resets to screenshot on every open, so only the others need a pick.
       * The Dropdown is an Ariakit Select with no id and no accessible name — it is
       * located by the label of the option it currently shows. */
      await dialog.getByText('screenshot (.png)', { exact: true }).first().click();
      await page.getByRole('option', { name: format.label, exact: true }).click();
      await expect(dialog.getByText(format.label, { exact: true }).first()).toBeVisible();
    }

    const downloadPromise = page
      .waitForEvent('download', { timeout: 8000 })
      .then((d) => `DOWNLOAD ${d.suggestedFilename()}`)
      .catch(() => 'NO DOWNLOAD');

    await dialog.getByRole('button', { name: /^Export$/i }).click();
    const outcome = await downloadPromise;
    const fresh = consoleErrors.slice(before);
    const line = `${format.value.padEnd(11)} -> ${outcome}${fresh.length ? ' | ' + fresh.join(' ;; ') : ''}`;
    results.push(line);
    console.log('PROBE ' + line);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  console.log(
    '\n===== EXPORT PROBE RESULTS =====\n' +
      results.join('\n') +
      '\n================================\n',
  );
});
