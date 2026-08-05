import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attachFixture, fileFixture, openFilesPanel } from './files.helpers';
import { measureCanon } from './canon.helpers';
import { NEW_CHAT_PATH } from './helpers';

/**
 * Canon rules that hold whatever screen is in front of you, so they can be
 * asserted before the redesign reaches a given screen rather than after.
 *
 * Ported from `tools/ui_probe.js` in the workspace rather than rewritten. Two
 * things it learned the hard way and this must not lose:
 *
 *  - focus is measured with real Tab presses, never `element.focus()`. The
 *    fork's focus styles hang off `:focus-visible`, which programmatic focus
 *    does not switch on — measuring that way calls every control unmarked.
 *  - the appearance is sampled from the element AND three ancestors. Composite
 *    controls (the composer, a field inside a bordered wrapper) draw the ring
 *    on the wrapper, not on themselves.
 */
type FocusResult = { element: string; name: string };

/**
 * `visited` is how many distinct controls the Tab walk actually landed on — not
 * how many the page has. Without it, a walk that stops moving focus reports an
 * empty list of offenders, which reads exactly like a clean screen.
 */
type FocusScan = { unmarked: FocusResult[]; visited: number };

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

async function controlsWithoutVisibleFocus(page: Page, limit = 60): Promise<FocusScan> {
  await page.evaluate((selector) => {
    const signature = (element: Element) => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let up = 0; up < 4 && node; up += 1, node = node.parentElement) {
        const style = getComputedStyle(node);
        parts.push(
          [
            style.outlineStyle,
            style.outlineWidth,
            style.outlineColor,
            style.boxShadow,
            style.borderColor,
            style.backgroundColor,
            style.color,
          ].join('|'),
        );
      }
      return parts.join('#');
    };
    const probe = window as unknown as {
      __signature: (element: Element) => string;
      __atRest: Map<string, string>;
    };
    probe.__signature = signature;
    probe.__atRest = new Map();
    let index = 0;
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        continue;
      }
      element.setAttribute('data-focus-probe', String(index));
      probe.__atRest.set(String(index), signature(element));
      index += 1;
    }
  }, FOCUSABLE);

  const unmarked: FocusResult[] = [];
  const seen = new Set<string>();
  /* Blur, not `body.focus()`: the body is not focusable, so focusing it does
   * nothing and the walk would start wherever the composer's autofocus left it.
   * Blurring the active element does move focus to the body, which is what
   * "from the top of the document" needs. */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) {
        return null;
      }
      const index = element.getAttribute('data-focus-probe');
      const probe = window as unknown as {
        __signature: (element: Element) => string;
        __atRest: Map<string, string>;
      };
      const classes =
        typeof element.className === 'string' && element.className
          ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
      return {
        index,
        unchanged: index == null ? null : probe.__signature(element) === probe.__atRest.get(index),
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}`,
        name: (element.getAttribute('aria-label') || (element as HTMLElement).innerText || '')
          .trim()
          .slice(0, 40),
      };
    });
    if (!current || current.index == null) {
      continue;
    }
    /* Wrapped around: the walk is done. A screen with a focus trap would end up
     * here after a control or two instead, which is why the count comes back
     * with the result rather than being thrown away. */
    if (seen.has(current.index)) {
      break;
    }
    seen.add(current.index);
    if (current.unchanged === true) {
      unmarked.push({ element: current.element, name: current.name });
    }
  }
  return { unmarked, visited: seen.size };
}

test.describe('canon — focus is visible', () => {
  /**
   * The offenders list is empty both when every control is marked and when the
   * walk never moved. This guard counts the controls the walk actually landed
   * on, not the controls the page contains: an earlier version counted matching
   * elements in the DOM, which stays healthy while Tab does nothing at all.
   */
  test('the Tab walk actually moves through controls', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const { visited } = await controlsWithoutVisibleFocus(page);
    expect(visited).toBeGreaterThan(5);
  });

  test('every control the keyboard reaches on the chat screen shows it has focus', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const { unmarked, visited } = await controlsWithoutVisibleFocus(page);
    expect(visited).toBeGreaterThan(5);
    expect(unmarked).toEqual([]);
  });
});

/**
 * Three more measurements ported from the same probe. All three come back empty
 * on the app today, which is why they belong on the pull-request gate: they cost
 * one page load and they turn the first regression red rather than the
 * hundredth.
 *
 * Each asserts what it looked at as well as what it found. An empty list of
 * offenders reads the same whether the screen is clean or the sweep reached
 * nothing, and every one of these sweeps has a way of reaching nothing — a
 * renamed token, a selector that stops matching, a dialog that never opened.
 */
test.describe('canon — layers, keyboard reach, layout shift', () => {
  const onChatScreen = async (page: Page) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    return measureCanon(page);
  };

  /**
   * The scale is read from the token layer at runtime rather than copied into
   * this file. Copying it would let the two drift apart silently, and the
   * drift would show up as this test going quiet, not as it going red.
   */
  test('every z-index comes from the canon scale', async ({ page }) => {
    test.setTimeout(90000);
    const chat = await onChatScreen(page);

    expect(chat.scale).toEqual([10, 109, 110, 990, 999, 1001, 1010]);
    expect(chat.layers).toEqual([]);
  });

  test('the file library dialog stacks on the canon scale too', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await attachFixture(page, fileFixture('notes.md'));
    await openFilesPanel(page);

    const withDialog = await measureCanon(page);
    /* A dialog is where a stray z-index shows up, and where it matters: the
     * fork already had settings lists render behind the settings dialog. */
    expect(withDialog.scale).toEqual([10, 109, 110, 990, 999, 1001, 1010]);
    expect(withDialog.layers).toEqual([]);
  });

  test('nothing is clickable by mouse but unreachable by keyboard', async ({ page }) => {
    test.setTimeout(90000);
    const chat = await onChatScreen(page);

    /* `cursor: pointer` inherits, so this sweep sees far more elements than it
     * reports — the icons and labels inside every button. If it ever sees none
     * at all, the selector or the exclusion has stopped matching and the empty
     * result below means nothing. */
    expect(chat.pointerCursor).toBeGreaterThan(5);
    expect(chat.reachable).toEqual([]);
  });

  test('every image reserves its space before it loads', async ({ page }) => {
    test.setTimeout(90000);
    const chat = await onChatScreen(page);

    /* At least the product logo, which carries width/height attributes. Zero
     * images seen would make the assertion below free. */
    expect(chat.images).toBeGreaterThan(0);
    expect(chat.cls).toEqual([]);
  });
});
