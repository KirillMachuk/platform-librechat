import { expect, test } from '@playwright/test';
import { identify, measureCanon } from '../mock/canon.helpers';

/**
 * Canon §4: on a phone every hit area is at least 44px in both directions. WCAG
 * 2.2 asks the same thing (2.5.8 Target Size), and axe does not check it — the
 * rule sits outside the tag set the accessibility suite runs with, so nothing
 * on the pull-request gate has ever looked at it.
 *
 * Nightly and phone-only on purpose: the rule is about fingers, the helper that
 * satisfies it (`.tap-target`, which grows the hit area with an invisible
 * `::after`) is itself inside `@media (max-width: 767.98px)`, and measuring at
 * desktop reports every icon button in the app as a violation of a rule that
 * does not apply there. Measured at 1280px this scan finds sixteen "violations"
 * and every one of them is noise.
 *
 * Known limit, carried over from the probe this is ported from: an element is
 * "visible" here if it has size and is not `display:none`, which includes a
 * drawer translated off-screen. Nothing off-screen is under 44px today, so the
 * limit costs nothing yet; narrowing it would mean inventing intersection logic
 * the workshop's mutation self-test has never checked.
 *
 * English only. The identifiers below fall back to the accessible name where an
 * element has no test id, so this spec must not be added to the Russian
 * project without giving those elements test ids first.
 */
const CHAT_PATH = '/c/new';

/**
 * The three controls in the chat header that are 36px today. Named by test id
 * where they have one, so a class rename does not move them.
 */
const UNDER_44 = ['Temporary Chat', 'add-multi-convo-button', 'model-selector-trigger'];

test.describe('canon — touch targets on a phone', () => {
  const scan = async (page: import('@playwright/test').Page) => {
    await page.goto(CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    return measureCanon(page);
  };

  /**
   * The clean result the canon asks for. It fails today, and the test below
   * says exactly how — `test.fail` on its own is satisfied by any failure,
   * including a broken selector, so it would quietly stop meaning anything.
   */
  test('every control a finger can reach is at least 44px', async ({ page }) => {
    test.fail();
    test.setTimeout(90000);
    const found = await scan(page);

    expect(found.targets).toEqual([]);
  });

  test('exactly three chat-header controls are under 44px', async ({ page }) => {
    test.setTimeout(90000);
    const found = await scan(page);

    /* Twenty-two controls on this screen. A sweep that reached two of them
     * would report no violations and read as a clean phone. */
    expect(found.interactive).toBeGreaterThan(10);
    expect(found.targets.map(identify).sort()).toEqual(UNDER_44);
  });

  /**
   * The measurement that makes the two above trustworthy. The sidebar toggle
   * draws at 32×32 and is **not** a violation: `.tap-target` grows its hit area
   * to 44 with an invisible `::after`, which is exactly the canon's own escape
   * hatch. Measuring the bounding box instead of the hit area would call this
   * control broken while it is obeying the rule — and the same mistake would
   * bury the three real findings above in a list of sixteen.
   */
  test('a control whose hit area is grown by ::after does not count as small', async ({ page }) => {
    test.setTimeout(90000);
    const found = await scan(page);

    const toggle = page.getByTestId('close-sidebar-button');
    const box = await toggle.boundingBox();
    expect(box?.width).toBeLessThan(44);
    expect(found.targets.map(identify)).not.toContain('close-sidebar-button');
  });

  /**
   * Opening the drawer takes the chat header off screen, and with it all three
   * findings. Asserted so the empty result is understood rather than mistaken
   * for the phone being clean: it is the same screen, minus the part that is
   * wrong.
   */
  test('with the drawer open the remaining controls all reach 44px', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    const opener = page.getByTestId('open-sidebar-button');
    if (await opener.isVisible().catch(() => false)) {
      await opener.click();
    }
    await expect(page.getByTestId('new-chat-button')).toBeVisible({ timeout: 20000 });

    const found = await measureCanon(page);
    expect(found.interactive).toBeGreaterThan(10);
    expect(found.targets).toEqual([]);
  });
});
