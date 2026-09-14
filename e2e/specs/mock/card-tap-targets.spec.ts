import { expect, test, devices } from '@playwright/test';
import type { Page } from '@playwright/test';
import { identify, measureCanon } from './canon.helpers';
import {
  answerAskUserCard,
  enableMcpServer,
  openAskUserCard,
  seedPlanCard,
  sendByButton,
} from './cards.helpers';
import { MOCK_ENDPOINTS, NEW_CHAT_PATH, selectMockEndpoint } from './helpers';

/**
 * Design review 02.09, item 6: four controls in the chat cards were the only
 * ones on the phone under the canon's 44px (§4; WCAG 2.5.8), measured at 375
 * with a touch profile — «Ещё N» under a plan (63×18), the «Thoughts» header
 * (82×20), the folded questions card (95×18) and the ✕ that cancels a research
 * (24 wide, the only way to cancel). The nightly touch-target scan never sees
 * them: it sweeps an empty chat, and these live in cards that only a
 * conversation produces.
 *
 * Same measure as that scan (`measureCanon`): the hit area is the box, or the
 * invisible `::after` the `.tap-target` helper grows on a positioned control.
 * Plus the check the workshop's tap probe added and the scan lacks — a grown
 * zone must not cover the CENTRE of a neighbouring control, or it steals the
 * neighbour's taps (the reason the helper stopped growing sideways on 14.08).
 *
 * Phone profile the way `touch-tap-chat.spec.ts` does it: emulation fields
 * only, `isMobile` is what makes chromium report `(pointer: coarse)`, which is
 * the media query the card's own phone rules hang on.
 */
const iphone = devices['iPhone 13'];
test.use({
  viewport: iphone.viewport,
  userAgent: iphone.userAgent,
  deviceScaleFactor: iphone.deviceScaleFactor,
  hasTouch: true,
  isMobile: true,
});

/** The premise: the phone rules must actually be in force in this profile. */
async function expectPhoneMedia(page: Page) {
  expect(
    await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      narrow: matchMedia('(max-width: 767.98px)').matches,
    })),
  ).toEqual({ coarse: true, narrow: true });
}

/**
 * Controls whose grown hit area covers the centre of another visible control.
 * Returns `"<control> covers <neighbour>"` lines, empty when clean.
 */
async function stolenCentres(page: Page, testIds: string[]): Promise<string[]> {
  return page.evaluate((ids) => {
    const MIN = 44;
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[role=button]'),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    });
    const grown = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const after = getComputedStyle(el, '::after');
      const positioned = getComputedStyle(el).position !== 'static';
      const hasAfter = positioned && after.content !== 'none' && after.position === 'absolute';
      const w = hasAfter ? Math.max(r.width, parseFloat(after.width) || 0) : r.width;
      const h = hasAfter ? Math.max(r.height, parseFloat(after.height) || 0) : r.height;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w, h };
    };
    const out: string[] = [];
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!el) {
        out.push(`${id} missing`);
        continue;
      }
      const g = grown(el);
      if (g.w < MIN || g.h < MIN) {
        out.push(`${id} is ${Math.round(g.w)}×${Math.round(g.h)}`);
      }
      for (const other of controls) {
        if (other === el || el.contains(other) || other.contains(el)) {
          continue;
        }
        const r = other.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx >= g.left && cx <= g.right && cy >= g.top && cy <= g.bottom) {
          const name =
            other.getAttribute('data-testid') ||
            other.getAttribute('aria-label') ||
            (other.textContent || '').trim().slice(0, 30);
          out.push(`${id} covers ${name}`);
        }
      }
    }
    return out;
  }, testIds);
}

test.describe('card controls reach 44px on a phone', () => {
  test('the «Thoughts» header, «Ещё N» under a plan and the cancel ✕', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await expectPhoneMedia(page);
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    await sendByButton(page, 'E2E_THINK_REPLY:tap');
    await expect(page.getByText('E2E think reply tap').first()).toBeVisible({ timeout: 30000 });
    const header = page.getByTestId('thinking-header');
    await expect(header).toHaveAttribute('aria-expanded', 'false', { timeout: 30000 });

    let found = await measureCanon(page);
    expect(found.interactive).toBeGreaterThan(5);
    expect(found.targets.map(identify)).not.toContain('thinking-header');
    expect(await stolenCentres(page, ['thinking-header'])).toEqual([]);
    /* The action row under a message: 28px wide to a finger until 14.09 (the
     * helper grows height only). Under a coarse pointer each button is now a
     * 44 box, so none of them may be reported small, and the fork button —
     * the one with a test id — must not cover a neighbour's centre. */
    const ACTION_ROW = [
      'fork-button',
      'Copy to clipboard',
      'Edit',
      'Branch to a new chat from here',
      'Regenerate',
      'Love this',
      'Needs improvement',
    ];
    const small = found.targets.map(identify);
    expect(small.filter((name) => ACTION_ROW.includes(name))).toEqual([]);
    expect(await stolenCentres(page, ['fork-button'])).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);

    await seedPlanCard(page);
    /* Awaiting approval: the ✕ is there and every step is on screen — a plan
     * being asked about is never cut to «Ещё N» (design review item 10). */
    await expect(page.getByTestId('dr-cancel')).toBeVisible();
    await expect(page.getByTestId('plan-more')).toHaveCount(0);
    /* The card's phone box must not push the head or the card sideways. */
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    found = await measureCanon(page);
    expect(found.targets.map(identify)).not.toContain('dr-cancel');
    expect(await stolenCentres(page, ['dr-cancel'])).toEqual([]);

    /* A later turn makes the plan a record: the preview well and «Ещё N» appear. */
    await sendByButton(page, 'E2E_THINK_REPLY:after');
    await expect(page.getByText('E2E think reply after').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('plan-more')).toBeVisible();
    await page.getByTestId('plan-more').scrollIntoViewIfNeeded();
    found = await measureCanon(page);
    expect(found.targets.map(identify)).not.toContain('plan-more');
    expect(await stolenCentres(page, ['plan-more'])).toEqual([]);
  });

  test('the folded questions card', async ({ page }) => {
    test.setTimeout(120000);
    /* The ask_user flow is the one ask-user.spec runs; the phone profile stays
     * (touch, coarse pointer) while the composer's tool menu is driven at a
     * desktop width, then the measurement is taken at the phone width. */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('PIN_MCP_', 'true');
    });
    await page.goto(NEW_CHAT_PATH, { waitUntil: 'domcontentloaded' });
    const textarea = page.getByTestId('text-input');
    await textarea.waitFor({ state: 'visible' });
    await enableMcpServer(page);
    await openAskUserCard(page);
    await answerAskUserCard(page);

    await page.setViewportSize(iphone.viewport);
    await expectPhoneMedia(page);
    await expect(page.getByTestId('ask-user-collapsed-toggle')).toBeVisible();
    const found = await measureCanon(page);
    expect(found.targets.map(identify)).not.toContain('ask-user-collapsed-toggle');
    expect(await stolenCentres(page, ['ask-user-collapsed-toggle'])).toEqual([]);
  });
});
