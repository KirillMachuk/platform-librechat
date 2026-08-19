import { expect, test } from '@playwright/test';
import { attachFixture, fileFixture, largeTextFixture } from './files.helpers';
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
