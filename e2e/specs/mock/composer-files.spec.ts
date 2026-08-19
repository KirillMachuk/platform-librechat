import { expect, test } from '@playwright/test';
import { attachFixture, chooseFixture, fileFixture, largeTextFixture } from './files.helpers';
import { NEW_CHAT_PATH } from './helpers';

/**
 * The composer's attachment ribbon (owner 18.08-1, round 18).
 *
 * Founding defect: five attached files WIDENED the composer to 1322px inside
 * an 800px form and the ribbon never scrolled — a chain of flex containers
 * without min-w-0 let the ribbon's min-content propagate up (a flex item's
 * min-width:auto refuses to shrink below its content). The fix pins min-w-0
 * on every link; this spec pins the OUTCOME on the real axis:
 * the shell stays inside the form, the ribbon itself scrolls sideways, and a
 * card still shows the name with its type+size line.
 */

const settled = async <T>(read: () => Promise<T>): Promise<T> => {
  let last = await read();
  await expect
    .poll(async () => {
      const next = await read();
      const same = JSON.stringify(next) === JSON.stringify(last);
      last = next;
      return same;
    })
    .toBe(true);
  return last;
};

test('attached files scroll sideways inside the composer instead of widening it', async ({
  page,
}) => {
  await page.goto(NEW_CHAT_PATH);

  await attachFixture(page, fileFixture('contract-long.docx'));
  await attachFixture(page, fileFixture('data.csv'));
  await attachFixture(page, fileFixture('deck-16x9.pptx'));
  await attachFixture(
    page,
    largeTextFixture('Отчёт_по_продажам_за_третий_квартал_2026_финальная_версия.md', 4000),
  );

  const geometry = await settled(() =>
    page.evaluate(() => {
      const shell = document.querySelector('[data-testid="composer-shell"]') as HTMLElement;
      const ribbon = shell.querySelector('.overflow-x-auto') as HTMLElement;
      const form = shell.closest('form') as HTMLElement;
      return {
        formW: form.clientWidth,
        shellW: shell.clientWidth,
        ribbonClientW: ribbon.clientWidth,
        ribbonScrollW: ribbon.scrollWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    }),
  );

  expect(geometry.shellW).toBeLessThanOrEqual(geometry.formW);
  expect(geometry.ribbonScrollW).toBeGreaterThan(geometry.ribbonClientW);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(0);

  const firstCard = page
    .locator('[data-testid="composer-shell"]')
    .getByRole('button', { name: 'contract-long.docx' });
  await expect(firstCard).toBeVisible();
  await expect(firstCard).toContainText('DOCX');
});

/**
 * Round 19 (owner 19.08, п.1–2): the chip must be COMPLETE from the first
 * frame — name and «DOCX …» badge come from the local record, not from the
 * server response (the card used to spend the whole upload as a bare size
 * line) — and the hover remove × has its own reserved corner: measured 17px
 * of × over the truncated name before the pr-7 reservation.
 *
 * The upload response is held behind a gate (not a timer) so the pre-response
 * state is a deterministic assertion window, released only after the frame-one
 * checks pass.
 */
test('the chip is complete from the first frame and the × never covers the name', async ({
  page,
}) => {
  await page.goto(NEW_CHAT_PATH);

  let releaseUpload = () => {};
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route('**/api/files', async (route) => {
    if (route.request().method() === 'POST') {
      await uploadGate;
    }
    await route.continue();
  });

  const name = 'Отчёт_по_продажам_за_август_2026_года.docx';
  const fixture = largeTextFixture(name, 19000);
  /* The browser-real worst case: a generic MIME that says nothing about the
   * format — the glyph and badge must still be right from frame one. */
  await chooseFixture(page, { ...fixture, name, mimeType: 'application/octet-stream' });

  const shell = page.locator('[data-testid="composer-shell"]');
  const card = shell.getByRole('button', { name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('DOCX');

  const geometry = await card.evaluate((button) => {
    const nameEl = button.querySelector('.truncate.font-medium') as HTMLElement;
    const removeEl = button.parentElement?.querySelector(
      'button[class*="absolute"][class*="right-1"][class*="top-1"]',
    ) as HTMLElement | null;
    if (!nameEl || !removeEl) {
      return null;
    }
    const nameRect = nameEl.getBoundingClientRect();
    const removeRect = removeEl.getBoundingClientRect();
    return {
      nameRight: nameRect.right,
      nameTop: nameRect.top,
      nameBottom: nameRect.bottom,
      removeLeft: removeRect.left,
      removeTop: removeRect.top,
      removeBottom: removeRect.bottom,
    };
  });
  expect(geometry).not.toBeNull();
  const onNameLine =
    geometry!.removeBottom > geometry!.nameTop && geometry!.removeTop < geometry!.nameBottom;
  expect(onNameLine).toBe(true);
  expect(geometry!.removeLeft).toBeGreaterThanOrEqual(geometry!.nameRight);

  const frameOne = {
    name: await card.locator('.truncate.font-medium').textContent(),
    badge: await card.locator('.truncate.text-text-secondary').textContent(),
  };

  releaseUpload();
  const uploaded = await page.waitForResponse(
    (response) => response.url().includes('/api/files') && response.request().method() === 'POST',
    { timeout: 60000 },
  );
  expect(uploaded.ok()).toBeTruthy();

  /* No jump: the settled card shows exactly what frame one showed. */
  await expect(card.locator('.truncate.font-medium')).toHaveText(frameOne.name ?? '');
  await expect(card.locator('.truncate.text-text-secondary')).toHaveText(frameOne.badge ?? '');
});
