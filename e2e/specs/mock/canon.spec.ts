import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

async function controlsWithoutVisibleFocus(page: Page, limit = 60): Promise<FocusResult[]> {
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
  await page.evaluate(() => document.body.focus());
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
    if (seen.has(current.index)) {
      break;
    }
    seen.add(current.index);
    if (current.unchanged === true) {
      unmarked.push({ element: current.element, name: current.name });
    }
  }
  return unmarked;
}

test.describe('canon — focus is visible', () => {
  test('the probe reaches controls at all', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    /* Without this, a Tab walk that reached nothing would report "no control
     * lacks a focus ring" forever. */
    const reached = await page.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }).length,
      FOCUSABLE,
    );
    expect(reached).toBeGreaterThan(5);
  });

  test('every control the keyboard reaches on the chat screen shows it has focus', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    expect(await controlsWithoutVisibleFocus(page)).toEqual([]);
  });
});
