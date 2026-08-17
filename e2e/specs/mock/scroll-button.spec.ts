import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  mockReply,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

/**
 * The scroll-to-bottom button (owner rounds 12/12-review): a 32px circle that
 * must hang FULLY VISIBLE, horizontally centered over the chat column, pinned
 * ~20px above the scrollport bottom, and live INSIDE the scroller.
 *
 * Both geometry claims exist because both broke in one week:
 * - upstream #12657 right-aligned it (justify-end went inert under md: on
 *   phones and the circle touched the viewport edge);
 * - the first sticky-rail fix let flexbox stretch its child to the rail's
 *   zero height, translateY(-100%) of nothing lifted nothing, and the circle
 *   drew downward with its bottom 12px cut by the scrollport edge — reviewers
 *   caught it live on prod.
 */
test.describe('scroll-to-bottom button', () => {
  test('appears centered and fully visible above the scrollport bottom', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    for (let i = 0; i < 3; i++) {
      const response = await sendMessage(page, `scroll ballast message ${i}`);
      expect(response.ok()).toBeTruthy();
      /* sendMessage resolves when the STREAM starts; sending again while the
       * composer is still streaming drops the Enter (seen as a 30s timeout on
       * the second send). Wait for this exchange's reply to land first —
       * chat.spec's inter-send pattern. */
      await expect(mockReply(page).nth(i)).toBeVisible({ timeout: 15000 });
      await expect(messagesView(page).getByText(`scroll ballast message ${i}`)).toBeVisible();
    }

    const scroller = page.locator('.scrollbar-gutter-stable').first();
    const scrollRange = () =>
      scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 15000,
      })
      .toBeGreaterThan(120);

    /* Positive readiness with self-healing: a late reflow of the final reply
     * can re-pin the list to the bottom right after a single programmatic
     * scroll (auto-follow still considers the viewer "at the bottom" until a
     * scroll event lands), hiding the button again — seen as a
     * one-in-two-repeats flake. Re-assert scrollTop=0 on every poll tick
     * until the button actually reports visible. */
    const button = page.getByRole('button', { name: 'Scroll to bottom' });
    await expect
      .poll(
        async () => {
          await scroller.evaluate((el) => {
            if (el.scrollTop !== 0) {
              el.scrollTop = 0;
            }
          });
          return button.isVisible();
        },
        { timeout: 15000 },
      )
      .toBe(true);

    const buttonBox = await button.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    expect(buttonBox).toBeTruthy();
    expect(scrollerBox).toBeTruthy();
    if (!buttonBox || !scrollerBox) {
      return;
    }
    /* Fully visible: the whole circle sits above the scrollport bottom with
     * the designed ~20px gap (>=8px tolerance for rounding), and none of it
     * is clipped by the top either. */
    expect(buttonBox.y).toBeGreaterThan(scrollerBox.y);
    expect(buttonBox.y + buttonBox.height).toBeLessThan(scrollerBox.y + scrollerBox.height - 8);
    /* Centered over the chat column — measured against the COMPOSER's axis,
     * not the scroller box: the thread carries scrollbar-gutter: stable while
     * the composer does not (the accepted ~4px deviation, ChatView.tsx), and
     * the button shares the composer's column chain, so THAT is the axis a
     * person sees it aligned to. */
    const composerBox = await page.getByRole('textbox', { name: 'Message input' }).boundingBox();
    expect(composerBox).toBeTruthy();
    if (!composerBox) {
      return;
    }
    const buttonCenterX = buttonBox.x + buttonBox.width / 2;
    const composerCenterX = composerBox.x + composerBox.width / 2;
    expect(Math.abs(buttonCenterX - composerCenterX)).toBeLessThanOrEqual(2);

    /* And it does its job: click returns the list to the bottom and the
     * button leaves. */
    await button.click();
    await expect.poll(scrollRange, { timeout: 10000 }).toBeLessThanOrEqual(40);
    await expect(button).toHaveCount(0, { timeout: 10000 });
  });
});
