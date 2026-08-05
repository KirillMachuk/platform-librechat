import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The Russian build, which is the one the client actually reads. The PR gate
 * only ever sees English, so a key that resolves in one language and not the
 * other — or a label that only overflows once translated — is invisible to it.
 */
const RAW_KEY = /\bcom_[a-z0-9_]+\b/;

/** Every string the page shows a user, wherever it is rendered. */
const visibleText = (page: Page) =>
  page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style')) {
        continue;
      }
      const text = (node.textContent ?? '').trim();
      if (text) {
        found.push(text);
      }
    }
    const labels = [...document.querySelectorAll('[aria-label], [placeholder], [title]')].flatMap(
      (element) =>
        ['aria-label', 'placeholder', 'title']
          .map((attribute) => element.getAttribute(attribute) ?? '')
          .filter(Boolean),
    );
    return [...found, ...labels];
  });

const rawKeys = async (page: Page) =>
  (await visibleText(page)).filter((text) => RAW_KEY.test(text));

test.describe('russian build', () => {
  test('the chat screen is in Russian, with no untranslated keys left showing', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    const input = page.getByRole('textbox', { name: 'Поле ввода сообщения' });
    await expect(input).toBeVisible();

    /* Naming a Russian control proves the locale took effect; without it a
     * build that fell back to English would pass the key check trivially. */
    await expect(page.getByTestId('new-chat-button')).toHaveText('Новый чат');
    expect(await rawKeys(page)).toEqual([]);
  });

  test('the file library is in Russian, with no untranslated keys left showing', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });
    await page.getByTestId('sidebar-link-files').click();
    const dialog = page.locator('div[role="dialog"]');
    await expect(dialog).toHaveCount(1);

    /* The dialog existing is not the dialog being drawn. Its table — the part
     * that renders labels from the shared package, which is where raw keys came
     * from in the first place — arrives after. Scanning on the dialog's
     * appearance alone measured the moment before the thing under test existed.
     * A column header is that content, and its Russian text is the locale
     * anchor this test was missing: without one, an English build would pass
     * the raw-key check for free. */
    await expect(dialog.getByRole('columnheader').first()).toBeVisible({ timeout: 20000 });
    await expect(dialog.getByText('Файлы').first()).toBeVisible();

    expect(await rawKeys(page)).toEqual([]);
  });
});
