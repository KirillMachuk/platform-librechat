import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attachFixture, fileFixture, openFilesPanel } from './files.helpers';
import { measureCanon } from './canon.helpers';
import { NEW_CHAT_PATH, openAccountMenu } from './helpers';

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
 * The ONE control allowed to stay visually silent on focus: the composer.
 * Owner's decision of 11.08 (DESIGN_SYSTEM §6.13, a named exception to §1.8):
 * the composer wears the sign-in card's dress and does not react to focus or
 * typing — the caret is its focus mark, and only the send icon answers input.
 * The exception is by id, not by element kind, so a second silent textarea
 * anywhere else still turns this spec red.
 */
const FOCUS_SILENT_IDS = new Set(['prompt-textarea']);

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
    const silent = [...FOCUS_SILENT_IDS].some((id) => current.element.includes(`#${id}`));
    if (current.unchanged === true && !silent) {
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
   * The scale is read from the token layer at runtime **and** pinned here. The
   * runtime read is what makes the second assertion mean anything: comparing
   * elements against a hardcoded list would keep passing while the tokens said
   * something else. The pin is what makes a token change loud — rename or drop
   * `--c-z-dialog` and this goes red naming the number that vanished, rather
   * than quietly shrinking the set of values it considers canonical.
   */
  test('every z-index comes from the canon scale', async ({ page }) => {
    test.setTimeout(90000);
    const chat = await onChatScreen(page);

    expect(chat.scale).toEqual([10, 109, 110, 999, 1001, 1010, 1020]);
    expect(chat.layers).toEqual([]);
  });

  /**
   * A dialog is where a stray z-index shows up, and where it matters.
   *
   * The fork used to run a parallel ladder in this band — panel dialog 120,
   * prompts menu 125, then OGDialog at 130/140 with +60 per level of nesting —
   * alongside the settings dialog on the canon 999. A dialog opened from
   * settings therefore landed *underneath* it: visible around the edges,
   * impossible to click. Reproduced and photographed before the fix by
   * `tools/layers_repro.js` in the workspace.
   *
   * The ladder is gone. Every modal now shares one layer, and which of two is
   * on top is decided by which was opened later, because a dialog opened later
   * is appended later in the document. That is how the browser's own top layer
   * behaves, and both dialog libraries the fork uses (Radix, Headless UI)
   * portal to the end of the document, so the guarantee holds across them.
   *
   * Found only once this sweep stopped filtering by size: the element carrying
   * a dialog's z-index is the wrapper Headless UI renders, and that wrapper has
   * no box of its own, so the check meant for dialog stacking had never once
   * looked at a dialog's own layer.
   */
  test('the file library dialog is on the canon dialog layer', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await attachFixture(page, fileFixture('notes.md'));
    await openFilesPanel(page);

    const withDialog = await measureCanon(page);
    expect(withDialog.scale).toEqual([10, 109, 110, 999, 1001, 1010, 1020]);
    expect(withDialog.layers).toEqual([]);
  });

  /**
   * The number on its own proves nothing — it only holds inside its own
   * stacking context, and an ancestor with a transform or an opacity silently
   * traps it. What a person cares about is whether the second window can be
   * used, so this opens a dialog from inside a dialog and asks the page who is
   * actually on top at the point a finger would land.
   */
  test('a dialog opened from a dialog is the one you can click', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

    const menu = await openAccountMenu(page);
    await menu.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Archived chats' }).click();
    await expect(page.locator('[role=dialog]')).toHaveCount(2);

    const nested = await page.evaluate(() => {
      /* Radix switches pointer events off on the body while a modal is open,
         so a plain hit test answers "what would catch the click", not "what is
         drawn on top" — and those two come apart in exactly the case this
         guards. With the buried dialog the clicks still landed on it, blind,
         underneath the dialog the person could see. Measured: this test passed
         against the reintroduced defect until the lock came off.

         Lifted on the body alone, not with a blanket `* { pointer-events:
         auto }`. The blanket version also revives layers that are deliberately
         click-through — the toast viewport is a full-screen `<ol>` above
         everything — and then the measurement reports the toast layer covering
         every dialog. Measured that too, on a build that was fine. */
      const previous = document.body.style.pointerEvents;
      document.body.style.pointerEvents = 'auto';
      const name = (el: Element | null) =>
        el
          ? `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`
          : 'nothing';
      try {
        /* Document order is open order: the dialog opened last is last. */
        const all = [...document.querySelectorAll('[role=dialog]')];
        const el = all[all.length - 1];
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          width: Math.round(r.width),
          onTop: !!top && el.contains(top),
          /* Named so a failure says who covered it, not just that something did. */
          nested: name(el),
          coveredBy: !top || el.contains(top) ? '' : name(top),
        };
      } finally {
        document.body.style.pointerEvents = previous;
      }
    });

    /* Guards against grabbing the size-less wrapper instead of the window. */
    expect(nested.width).toBeGreaterThan(200);
    expect(nested).toMatchObject({ onTop: true, coveredBy: '' });
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
