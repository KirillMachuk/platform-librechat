import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { NEW_CHAT_PATH, openAccountMenu } from './helpers';

/**
 * This is a white-label fork: the client must never see the upstream name.
 * `scripts/rebrand.sh` rewrites it after every upstream merge, and its audit
 * covers the files it knows about — but a merge that introduces a new string in
 * a file the script does not scan slips through, which has happened before.
 * These tests look at what the running app actually shows.
 */
const UPSTREAM_NAME = /LibreChat/i;

/** Everything the page renders or announces, including attributes and the tab title. */
const shownText = (page: Page) =>
  page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: string[] = [document.title];
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent && !parent.closest('script, style')) {
        const text = (walker.currentNode.textContent ?? '').trim();
        if (text) {
          found.push(text);
        }
      }
    }
    for (const element of document.querySelectorAll(
      '[aria-label], [placeholder], [title], [alt]',
    )) {
      for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = element.getAttribute(attribute);
        if (value) {
          found.push(value);
        }
      }
    }
    for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
      const value = meta.getAttribute('content');
      if (value) {
        found.push(value);
      }
    }
    return found;
  });

const upstreamMentions = async (page: Page) =>
  (await shownText(page)).filter((text) => UPSTREAM_NAME.test(text));

/** The fork's own name, which the scan must be able to see. */
const PRODUCT_NAME = /1ma/i;

test.describe('branding', () => {
  /* Without this, a scan that silently stopped finding text would make every
   * "never shows the upstream name" assertion below pass forever. */
  test('the scan can see what the page shows', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const shown = await shownText(page);
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.filter((text) => PRODUCT_NAME.test(text)).length).toBeGreaterThan(0);
  });

  test('the chat screen never shows the upstream product name', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    expect(await upstreamMentions(page)).toEqual([]);
  });

  test('the account menu and settings never show it either', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openAccountMenu(page);
    await expect(page.getByRole('menu')).toBeVisible();

    expect(await upstreamMentions(page)).toEqual([]);
  });

  test('the login screen never shows it', async ({ page, context }) => {
    test.setTimeout(90000);
    await context.clearCookies();
    await page.goto('/login', { timeout: 15000 });
    /* A stale session would silently redirect to the chat and this would become
     * a second copy of the test above, passing for the wrong screen. */
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
    await expect(page.getByRole('button', { name: /Log in|Continue/i }).first()).toBeVisible({
      timeout: 20000,
    });

    expect(await upstreamMentions(page)).toEqual([]);
  });
});

test.describe('help', () => {
  /**
   * The entry opens a new tab. `window.open` is replaced rather than followed:
   * the help centre is a real external site and this suite must not reach for
   * the network to prove which address a button points at.
   */
  test('the account menu offers help, pointing at the configured address', async ({ page }) => {
    test.setTimeout(90000);
    await page.addInitScript(() => {
      const opened: string[] = [];
      Object.defineProperty(window, '__openedUrls', { value: opened });
      window.open = (url?: string | URL) => {
        opened.push(String(url ?? ''));
        return null;
      };
    });
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await openAccountMenu(page);

    const help = page.getByRole('menuitem', { name: /Help/i });
    await expect(help).toBeVisible();
    await help.click();

    const opened = await page.evaluate(() => [
      ...(window as unknown as WindowWithOpened).__openedUrls,
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https?:\/\//);
    expect(opened[0]).not.toMatch(UPSTREAM_NAME);
  });
});

interface WindowWithOpened extends Window {
  __openedUrls: string[];
}
