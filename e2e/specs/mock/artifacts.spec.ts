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

    /* The card knows it too — the same click seen from the other side. Since
     * round 12 the caption is STATIC («Click to open» stays; the open/close
     * swap resized the content-sized chip on every tap), so the open state
     * reads from the selected restyle instead: the transparent border becomes
     * the hairline on hover-capable screens (on touch the panel is a bottom
     * sheet over a scrim and the card deliberately shows nothing). */
    await expect(card).toContainText('Click to open');
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).borderTopColor), { timeout: 5000 })
      .not.toBe('rgba(0, 0, 0, 0)');

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
   * Opening the panel must not move the conversation.
   *
   * The owner opened a file from a message and the chat jumped back as if the
   * page had reloaded — again on closing, and only ever on the FIRST open,
   * which is the tell: the conversation was being wrapped in a card element
   * only while the panel was open, so the element at that position changed and
   * React rebuilt the whole subtree. Anything mounted inside it — the scroll
   * position, a half-typed message, a video — started over.
   *
   * Measured as "the message you were looking at is still on screen" rather
   * than as a scrollTop equality: the column genuinely narrows when the panel
   * takes its half, so the content reflows and a few pixels of drift are
   * honest. A remount is not drift; it puts you somewhere else entirely.
   */
  test('opening and closing the panel leaves the conversation where it was', async ({ page }) => {
    test.setTimeout(150000);
    /* Short viewport so a couple of replies are already taller than the column
       — with nothing to scroll, this test would pass on the defect. */
    await page.setViewportSize({ width: 1200, height: 520 });
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    await sendMessage(page, 'E2E_ARTIFACT_REPLY');
    const card = messagesView(page).getByRole('button').filter({ hasText: 'E2E Artifact' });
    await expect(card.first()).toBeVisible({ timeout: 60000 });
    await sendMessage(page, 'E2E_ARTIFACT_REPLY');
    await expect(card.nth(1)).toBeVisible({ timeout: 60000 });

    /* The scroller is found by behaviour, not by class: whichever box inside
       the conversation actually overflows is the one a remount would reset. */
    const scroller = await page.evaluateHandle(() => {
      const view = document.querySelector('[data-testid="messages-view"]');
      const boxes = view ? Array.from(view.querySelectorAll('*')) : [];
      return (
        boxes.find((element) => {
          const style = getComputedStyle(element);
          return (
            /(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 40
          );
        }) ?? null
      );
    });
    expect(await scroller.evaluate((element) => element != null)).toBe(true);

    await scroller.evaluate((element: Element) => {
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 240);
    });
    const before = await scroller.evaluate((element: Element) => ({
      top: element.scrollTop,
      fromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
    }));
    expect(before.top, 'the conversation is scrolled away from both ends').toBeGreaterThan(20);

    await card.first().click();
    await expect(page.locator('#artifacts-code')).toHaveCount(1, { timeout: 30000 });
    const opened = await scroller.evaluate((element: Element) => ({
      top: element.scrollTop,
      fromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
      connected: element.isConnected,
    }));

    /* A rebuilt subtree leaves the old node orphaned — the cheapest proof that
       the conversation survived at all. */
    expect(opened.connected, 'the conversation was not rebuilt').toBe(true);
    expect(Math.abs(opened.fromBottom - before.fromBottom)).toBeLessThan(160);

    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.locator('#artifacts-code')).toHaveCount(0, { timeout: 30000 });
    const closed = await scroller.evaluate((element: Element) => ({
      fromBottom: element.scrollHeight - element.clientHeight - element.scrollTop,
      connected: element.isConnected,
    }));
    expect(closed.connected, 'closing the panel did not rebuild it either').toBe(true);
    expect(Math.abs(closed.fromBottom - before.fromBottom)).toBeLessThan(160);
  });

  /**
   * The canon decision behind PR #265, silently reverted once already by an
   * unrelated PR that merged from a stale base and restored in PR #309 — see
   * `feedback_unguarded_canon_decision_gets_reverted` in project memory. That
   * restore put the files back; this is the guard the incident was missing,
   * so a third silent revert fails CI instead of waiting for someone to
   * notice the live site looks wrong.
   *
   * The selector is `cardClassName` from `SidePanelGroup.tsx` verbatim — a
   * plain template-string concatenation in that component, not `cn()`, so
   * nothing merges a class away before it reaches the DOM.
   */
  test('the open panel gives the chat and the artifact their own card, and the gap between them is the handle', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);

    const cards = () =>
      page.locator(
        '.h-full.overflow-hidden.rounded-2xl.border-border-light.bg-presentation.shadow-sm',
      );
    /* Before the panel opens there is one column, not a card — without this,
     * a count of 2 after clicking the artifact would not prove anything. */
    expect(await cards().count()).toBe(0);

    const response = await sendMessage(page, 'E2E_ARTIFACT_REPLY');
    expect(response.ok()).toBeTruthy();
    const artifactCard = messagesView(page).getByRole('button').filter({ hasText: 'E2E Artifact' });
    await expect(artifactCard).toBeVisible({ timeout: 60000 });
    await artifactCard.click();
    await expect(page.locator('#artifacts-code')).toHaveCount(1, { timeout: 30000 });

    /* Two cards now: the chat column and the artifact panel, each carrying
     * its own frame instead of the group being painted. */
    await expect(cards()).toHaveCount(2);
    const styles = await cards().evaluateAll((elements) =>
      elements.map((element) => {
        const computed = getComputedStyle(element);
        return { radius: computed.borderRadius, borderWidth: computed.borderWidth };
      }),
    );
    for (const style of styles) {
      expect(style.radius).toBe('16px');
      expect(style.borderWidth).not.toBe('0px');
    }

    /* The gap between the two cards is the handle, not a separate divider
     * line — `ArtifactsPanel.tsx` renders the handle's own track transparent
     * on purpose. Found structurally, from where the two cards' own boxes
     * actually leave a gap, rather than guessed by class name: this repo has
     * a documented case of `cn()` silently dropping a losing class, and the
     * point here is what the browser actually painted. Sampled near the top
     * of the gap, not its vertical center, to land on the track rather than
     * the drag-grip icon that sits centered and invisible until hover. */
    const [chatBox, artifactBox] = await cards().evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top };
      }),
    );
    expect(artifactBox.left).toBeGreaterThan(chatBox.right);
    const gapMidX = (chatBox.right + artifactBox.left) / 2;
    const gapY = chatBox.top + 24;
    const handleBackground = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element ? getComputedStyle(element).backgroundColor : null;
      },
      { x: gapMidX, y: gapY },
    );
    expect(handleBackground).toBe('rgba(0, 0, 0, 0)');

    /* Mobile: the artifact panel stops being a card and becomes an overlay —
     * `isSmallScreen` flips `split` to false in `SidePanelGroup.tsx`, whose
     * own comment says there is no frame on the phone layout. */
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => cards().count(), { timeout: 10000 }).toBe(0);
    await expect(page.locator('.fixed.inset-0.z-scrim-drawer')).toBeVisible({ timeout: 10000 });
  });
});
