import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

/**
 * Canon §6.14: "Кнопки под ответом ... видны всегда" — the row under an answer
 * is not a hover affordance. The owner agreed it, `HoverButtons.tsx` carries
 * the decision in a comment above the class that implements it, and it has
 * still been only half-true: the rule reached the buttons built from
 * `HoverButton` (copy, edit, read aloud, regenerate) and missed the two that
 * are their own components and sit in the same row — Fork and Feedback. On an
 * answer that is not the last one, those stayed at `opacity: 0` until the
 * mouse found them.
 *
 * Nothing watched the rule, which is how the miss survived. It is invisible to
 * every other test here: Playwright clicks straight through `opacity: 0`
 * without complaining, so a suite that only clicks these buttons stays green
 * while nobody can see them.
 *
 * So this measures what the eye gets — computed opacity, on an answer that is
 * NOT the last one, with the pointer parked in the corner. Playwright's
 * desktop chromium reports `hover: hover`, which is the media query the defect
 * hid behind; on a touch profile this would pass for the wrong reason.
 */
const AWAY = { x: 5, y: 5 };

/**
 * Opacity as painted, multiplied up the ancestors — the compositor's own
 * arithmetic. Reading only the button would miss a faded wrapper, and the rule
 * that hides these can live on either.
 */
async function paintedOpacity(target: Locator) {
  await expect(target).toBeAttached();
  return target.evaluate((element) => {
    let opacity = 1;
    let node: HTMLElement | null = element as HTMLElement;
    while (node && node !== document.body) {
      opacity *= Number(getComputedStyle(node).opacity || '1');
      node = node.parentElement;
    }
    return opacity;
  });
}

/** Two turns, so there is an answer that is not the last one. */
async function twoTurns(page: Page) {
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
  await sendMessage(page, replyPrompt('first'));
  await sendMessage(page, replyPrompt('second'));
  /* `.first()` on purpose: the reply text also exists in a screen-reader-only
   * copy, and `sr-only` is clipped rather than hidden, so an unqualified
   * `getByText` matches two elements and fails strict mode — intermittently,
   * depending on when that copy mounts. */
  await expect(page.getByText(replyText('second')).first()).toBeVisible({ timeout: 30000 });
  await page.mouse.move(AWAY.x, AWAY.y);
}

test.describe('the buttons under an answer', () => {
  test('an older answer keeps its actions on screen, not behind the mouse', async ({ page }) => {
    test.setTimeout(120000);
    await twoTurns(page);

    const forks = page.getByTestId('fork-button');
    /* A retrying sync point, not a single read: `sendMessage` resolves on the
     * streamed response, and the row of buttons for the earlier turns is still
     * being rendered for a moment after that. Without this the count below
     * caught one button and the comparison meant nothing. */
    await expect.poll(() => forks.count(), { timeout: 30000 }).toBeGreaterThan(1);

    /* The measurement works and the button can be visible: the same control on
     * the newest answer has never been the broken half. Without this half, a
     * run where Fork stopped rendering at all would look like a pass. */
    expect(
      await paintedOpacity(forks.last()),
      'the newest answer has always shown its branch button',
    ).toBeGreaterThan(0.99);

    /* And a control from the row that already follows the canon, on the very
     * message under test — so "the older row is simply not painted yet" cannot
     * explain a failure below. */
    expect(
      await paintedOpacity(page.getByTitle('Copy to clipboard').first()),
      'copy on the older turn already follows the canon',
    ).toBeGreaterThan(0.99);

    expect(
      await paintedOpacity(forks.first()),
      'an older answer must show its branch button too, without being hovered',
    ).toBeGreaterThan(0.99);

    /* Feedback is the other component that missed the rule, and it lives in
     * the same row on the same message — asserted here rather than in a test
     * of its own, which would pay for a second two-turn conversation to look
     * at the buttons already on this screen.
     *
     * These render on answers only, so two turns give two of each: `.first()`
     * is the older answer, `.last()` the newest. */
    const likes = page.getByTitle('Love this');
    const dislikes = page.getByTitle('Needs improvement');
    await expect.poll(() => likes.count(), { timeout: 30000 }).toBeGreaterThan(1);

    expect(
      await paintedOpacity(likes.last()),
      'the newest answer has always shown its feedback buttons',
    ).toBeGreaterThan(0.99);
    expect(
      await paintedOpacity(likes.first()),
      'an older answer must show its like button without being hovered',
    ).toBeGreaterThan(0.99);
    expect(await paintedOpacity(dislikes.first()), 'and its dislike button').toBeGreaterThan(0.99);
  });
});
