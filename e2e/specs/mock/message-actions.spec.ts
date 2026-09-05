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
      await paintedOpacity(page.getByLabel('Copy to clipboard').first()),
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
    /* By accessible name, not by `title`: the 15.08 tooltip sweep replaced the
       OS balloon with the canon ink plate everywhere, so the name these
       buttons carry is their `aria-label` now. A `getByTitle` locator would
       silently resolve to zero and every assertion below it would pass for
       free — which is how this one failed loudly instead. */
    const likes = page.getByRole('button', { name: 'Love this' });
    const dislikes = page.getByRole('button', { name: 'Needs improvement' });
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

/**
 * A copied message is the message — nothing more. The row of controls under a
 * turn and the screen-reader-only heading over it («Prompt 1:», «Response 2:»)
 * are not content, yet a selection used to take them along: a triple-click
 * serialised the empty toolbar blocks into a tail of blank lines (6 on a
 * question, 9 on an answer, measured with tools/copy_selection_probe.js), and a
 * selection dragged across turns copied the invisible headings. The owner met
 * the first as «…дай прогноз подробный» followed by five empty lines.
 *
 * Read from the clipboard itself, not from the DOM: what the browser hands to
 * the paste is the only thing the user sees. Chromium's own triple-click also
 * takes the "paragraph break" after a `<p>` and serialises it as two newlines
 * (measured on a bare page) — the transcript ends a mouse selection at the
 * last character it covers (`useTrimSelectionEnd`), so a copied message is
 * exactly the message.
 */
test.describe('copying a message by selection', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a triple-click copies the message text without a tail of blank lines', async ({ page }) => {
    await twoTurns(page);
    const first = page.getByText(replyText('first')).first();
    await first.click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+C');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(replyText('first'));
  });

  test('the last message in the chat copies the same way (its selection used to run into the composer strip)', async ({
    page,
  }) => {
    await twoTurns(page);
    await page.getByText(replyText('second')).first().click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(replyText('second'));
  });

  test('a drag released below the message copies the message, not the blank space under it', async ({
    page,
  }) => {
    await twoTurns(page);
    const first = page.getByText(replyText('first')).first();
    const box = await first.boundingBox();
    if (!box) {
      throw new Error('the first reply has no box');
    }
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(box.x + 1, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height + 40, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(replyText('first'));
  });

  test('a drag from the last message released over the composer copies exactly the message', async ({
    page,
  }) => {
    await twoTurns(page);
    const last = page.getByText(replyText('second')).first();
    const box = await last.boundingBox();
    const composer = await page.getByRole('textbox', { name: 'Message input' }).boundingBox();
    if (!box || !composer) {
      throw new Error('no boxes to drag between');
    }
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.mouse.move(box.x + 1, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(composer.x + composer.width / 2, composer.y + composer.height / 2, {
      steps: 20,
    });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(replyText('second'));
  });

  test('a code line keeps its newline: inside a code block a newline is content', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    /* A code block in the user's own message — the same markdown renderer. */
    await sendMessage(page, '```\nreturn 1\nreturn 2\n```');
    const line = page.getByText('return 1', { exact: false }).first();
    await expect(line).toBeVisible({ timeout: 30000 });
    /* Chromium's triple-click inside <pre> selects the line and its newline. */
    await line.click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('return 1\n');
  });

  test('a selection in the edit textarea is left alone', async ({ page }) => {
    await twoTurns(page);
    const turn = page
      .getByText(replyPrompt('first'))
      .first()
      .locator('xpath=ancestor::*[contains(@class,"message-render")][1]');
    await turn.hover();
    await turn.getByRole('button', { name: /Edit/ }).first().click();
    const editor = page.getByTestId('message-text-editor').first();
    await expect(editor).toBeVisible();
    /* Select inside the field the way a keyboard user does, then release the
     * mouse over the field — the release is what the trim listens to, and a
     * release in a text field must leave the field's own selection alone. */
    await editor.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const before = await editor.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      return [t.selectionStart, t.selectionEnd];
    });
    expect(before[1]).toBeGreaterThan(before[0]);
    const box = await editor.boundingBox();
    if (!box) {
      throw new Error('the editor has no box');
    }
    await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
    await page.mouse.up();
    const after = await editor.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      return [t.selectionStart, t.selectionEnd];
    });
    expect(after).toEqual(before);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
  });

  test('a selection across turns carries no screen-reader headings', async ({ page }) => {
    await twoTurns(page);
    const first = page.getByText(replyText('first')).first();
    const second = page.getByText(replyText('second')).first();
    /* The selection is built as a Range from the first reply to the second — the
     * same object a drag across both turns produces — because a page without a
     * caret cannot be extended from the keyboard, and a drag depends on layout. */
    await first.evaluate(
      (from, to) => {
        const range = document.createRange();
        range.setStartBefore(from);
        range.setEndAfter(to as Node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
      await second.elementHandle(),
    );
    await page.keyboard.press('ControlOrMeta+C');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(replyText('first'));
    expect(copied).toContain(replyText('second'));
    expect(copied).not.toMatch(/^(Prompt|Response) \d+:/m);
    expect(copied).not.toMatch(/\n\s*\n\s*\n/);
  });
});
