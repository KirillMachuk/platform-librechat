import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  selectMockEndpoint,
  sendMessage,
} from './helpers';

/**
 * The artifacts panel at a desktop width that is not generous.
 *
 * Artifacts had unit coverage for where they render (`ArtifactRouting`) and for
 * the breakpoint at which the panel switches to the phone layout, but nothing
 * had ever opened the panel in a browser. The width matters because the panel
 * takes its half of the screen from the conversation: at 1000px there is not
 * much to take, and the failure this guards against is a chat column squeezed
 * to nothing, or a page that starts scrolling sideways.
 *
 * The fixture is new — the fake model had no artifact reply before this — and
 * uses the `:::artifact:::` container the client's own remark plugin looks for.
 *
 * Three wrong anchors were tried before this settled, and each one is worth
 * naming because each was wrong in a different way:
 *
 *   the artifact's TEXT — useless. With the panel shut, the artifact's heading
 *       was still found, inside a page-level `sr-only` container two levels
 *       below `body`; `sr-only` is clipped rather than hidden, so Playwright
 *       counts it visible. That version passed with the panel firmly shut and
 *       only deleting the card's click handler exposed it. Which component owns
 *       that container was NOT established — an earlier version of this comment
 *       said it was a screen-reader copy of the reply carried by the message,
 *       and a review found no such element. What is established is the element
 *       chain above and the rule it implies: do not anchor on text that a
 *       screen-reader-only node may also carry.
 *   the panel's Code/Preview controls as `role="tab"` — they are not tabs in
 *       the accessibility tree, so three runs went red against a panel that was
 *       in fact open. Load was blamed first; on a quiet machine it failed the
 *       same way, which is what sent this looking at the DOM instead.
 *   the code pane by VISIBILITY — it is the inactive tab's content. The panel
 *       opens on preview, so the code pane is mounted and hidden.
 */
const NARROW_DESKTOP = { width: 1000, height: 800 };

/**
 * Sideways scroll, measured on the document AND on `main`. Same shape as the
 * nightly layout check, and for the same reason recorded there: a wide element
 * inside `main` leaves the document's own scrollWidth alone, because `main`
 * scrolls instead.
 */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      mainScrollWidth: main?.scrollWidth ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
    };
  });

/**
 * The split as a person sees it (canon §4, §6.15): two cards with a gap between
 * them, not one surface with a rule down the middle.
 *
 * The unit guards pin the classes; only a browser can answer the question that
 * actually went wrong — WHICH layer ends up painting the 8px between the cards.
 * Four surfaces stack there (the app frame, the route's card, the drag-and-drop
 * wrapper, the panel group) and any one of them left painting fills the gap
 * with card colour, at which point the two cards read as one again with two
 * hairlines in the middle of it. So the check climbs out of the handle to the
 * first ancestor that paints, and compares that with the cards' own fill.
 */
const split = (page: Page) =>
  page.evaluate(() => {
    const OPAQUE = (color: string) => color !== 'transparent' && !/,\s*0\)$/.test(color);

    /** Our card is the child of the wrapper the layout library puts in a panel. */
    const cardAround = (inner: Element | null) => {
      let node = inner;
      while (node?.parentElement && !node.parentElement.hasAttribute('data-panel')) {
        node = node.parentElement;
      }
      return node?.firstElementChild ?? null;
    };

    const paintedBehind = (element: Element) => {
      let node: Element | null = element.parentElement;
      while (node) {
        const color = getComputedStyle(node).backgroundColor;
        if (OPAQUE(color)) {
          return color;
        }
        node = node.parentElement;
      }
      return null;
    };

    const handle = document.querySelector('#artifacts-panel')?.previousElementSibling ?? null;
    const chatCard = cardAround(document.querySelector('#messages-view main'));
    const panelCard = cardAround(document.querySelector('#artifacts-code'));
    if (handle == null || chatCard == null || panelCard == null) {
      return null;
    }

    const dress = (card: Element) => {
      const style = getComputedStyle(card);
      return {
        radius: style.borderTopLeftRadius,
        borderWidth: style.borderTopWidth,
        shadow: style.boxShadow,
        fill: style.backgroundColor,
      };
    };

    return {
      /* Proof the two elements found are the right ones, so a structural change
         fails loudly instead of measuring some other box. */
      holdsChat: chatCard.contains(document.querySelector('#messages-view main')),
      holdsPanel: panelCard.contains(document.querySelector('#artifacts-code')),
      gap: panelCard.getBoundingClientRect().left - chatCard.getBoundingClientRect().right,
      handleFill: getComputedStyle(handle).backgroundColor,
      behindHandle: paintedBehind(handle),
      chat: dress(chatCard),
      panel: dress(panelCard),
    };
  });

test.describe('artifacts', () => {
  test('the panel opens at a narrow desktop width and leaves the chat usable', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, 'E2E_ARTIFACT_REPLY');
    expect(response.ok()).toBeTruthy();

    /* The card, not the markup: an artifact that failed to route would show its
     * own source in the message instead, and this locator would not match while
     * the text below would. */
    const card = messagesView(page).getByRole('button').filter({ hasText: 'E2E Artifact' });
    await expect(card).toBeVisible({ timeout: 60000 });
    await expect(messagesView(page).getByText(':::artifact')).toHaveCount(0);

    /* Not on screen until an artifact is selected — the half that makes the
     * assertion after the click mean something. */
    const panelPane = page.locator('#artifacts-code');
    await expect(panelPane).toHaveCount(0);

    await card.click();

    /* The panel's own pane is what says it opened, and it is asserted as a
     * before-and-after pair: the panel only mounts once an artifact is
     * selected, so "absent, then visible" is a statement about the click.
     *
     * Two wrong anchors were tried first, both worth naming. The artifact's
     * TEXT is useless: the message carries a screen-reader copy of the whole
     * reply in an `sr-only` div, and `sr-only` is clipped rather than hidden,
     * so Playwright counts it visible — that version passed with the panel
     * firmly shut, and only deleting the card's click handler exposed it.
     * And the panel's Code/Preview controls are not `role="tab"`, which sent
     * three runs red against a panel that was in fact open. */
    await expect(panelPane).toHaveCount(1, { timeout: 30000 });
    /* And something of the panel a person can actually see. The pane above is
     * asserted by presence rather than visibility on purpose: it is the code
     * tab's content, and the panel opens on the preview tab, so the code pane
     * is mounted but hidden. Its own toolbar is not. */
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible({ timeout: 30000 });

    /* The card knows it too, and says so — the same click seen from the other
     * side. */
    await expect(card).toContainText('Click to close');

    /* And the half a person still needs: the composer is not squeezed away, and
     * it still takes what they type. Without this the assertion above is happy
     * with a panel that has eaten the conversation. */
    const composer = page.getByRole('textbox', { name: 'Message input' });
    await expect(composer).toBeVisible();
    const composerBox = await composer.boundingBox();
    expect(composerBox?.width ?? 0).toBeGreaterThan(200);
    await composer.fill('still typing with the panel open');
    await expect(composer).toHaveValue('still typing with the panel open');

    const measured = await overflow(page);
    expect(measured.docScrollWidth).toBeLessThanOrEqual(measured.innerWidth + 1);
    /* A `main` of zero width would make the line below pass for free. */
    expect(measured.mainClientWidth).toBeGreaterThan(0);
    expect(measured.mainScrollWidth).toBeLessThanOrEqual(measured.mainClientWidth + 1);
  });

  /**
   * This layout landed in #265 and was reverted byte for byte by #267 two
   * commits later — a branch cut from a stale base — and nothing went red. It
   * reached production that way and was found by eye.
   */
  test('shows the chat and the panel as two cards with canvas between them', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const response = await sendMessage(page, 'E2E_ARTIFACT_REPLY');
    expect(response.ok()).toBeTruthy();

    const card = messagesView(page).getByRole('button').filter({ hasText: 'E2E Artifact' });
    await expect(card).toBeVisible({ timeout: 60000 });
    await card.click();
    await expect(page.locator('#artifacts-code')).toHaveCount(1, { timeout: 30000 });
    /* The panel animates in from the right; measuring before it settles reads a
       gap that is merely on its way to 8. */
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible({ timeout: 30000 });

    const measured = await split(page);
    expect(measured).not.toBeNull();
    if (measured == null) {
      return;
    }

    expect(measured.holdsChat).toBe(true);
    expect(measured.holdsPanel).toBe(true);

    /* Canon §4: radius 16, a hairline, and one of the two shadows — on BOTH, or
       the panel reads as a region of the chat rather than a surface beside it. */
    for (const dress of [measured.chat, measured.panel]) {
      expect(dress.radius).toBe('16px');
      expect(dress.borderWidth).toBe('1px');
      expect(dress.shadow).not.toBe('none');
    }
    expect(measured.panel.fill).toBe(measured.chat.fill);

    /* The gap IS the handle: 8px, and the prototype draws no strip in it. */
    expect(measured.gap).toBeGreaterThanOrEqual(7);
    expect(measured.gap).toBeLessThanOrEqual(9);
    expect(measured.handleFill).toMatch(/,\s*0\)$|^transparent$/);

    /* And what shows through it is the canvas, not more card. Everything above
       reads the same when a wrapper behind the handle still paints the card
       fill: the cards are there, the gap is there, and the split still looks
       like one surface with a line down it. */
    expect(measured.behindHandle).not.toBeNull();
    expect(measured.behindHandle).not.toBe(measured.chat.fill);
  });
});
