import { expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import type { Page } from '@playwright/test';
import { NEW_CHAT_PATH, getAccessToken, requestJson } from './helpers';
import { applyRuntimeEnv } from '../../setup/runtimeEnv';

/** Five past the server's page of 25, so the last one can only be on page two. */
const SEEDED_CONVERSATIONS = 30;

/** Size of the virtualized chat list grid vs. its measured container. */
const sizes = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('aside .ReactVirtualized__Grid');
    const wrap = grid?.parentElement ?? null;
    const gridRect = grid?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    return {
      grid: gridRect ? gridRect.width : -1,
      wrap: wrapRect ? wrapRect.width : -1,
      gridH: gridRect ? gridRect.height : -1,
      wrapH: wrapRect ? wrapRect.height : -1,
    };
  });

/**
 * Polls until the grid matches its container AND the size has stopped changing
 * between samples — the sidebar expand/collapse animation runs for 300ms, and a
 * tracking-only check can match mid-animation on slow CI machines.
 */
const settledSizes = async (page: Page) => {
  let prev = await sizes(page);
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(350);
    const next = await sizes(page);
    const tracked =
      next.wrap > 0 &&
      next.wrapH > 0 &&
      Math.abs(next.grid - next.wrap) <= 1 &&
      Math.abs(next.gridH - next.wrapH) <= 1;
    const stable = Math.abs(next.grid - prev.grid) <= 1 && Math.abs(next.gridH - prev.gridH) <= 1;
    if (tracked && stable) {
      return next;
    }
    prev = next;
  }
  throw new Error(`Sidebar chat list never settled: ${JSON.stringify(prev)}`);
};

test.describe('sidebar chat list', () => {
  test('chat list width tracks the sidebar through collapse and viewport cycles', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.goto('/c/new', { timeout: 10000 });
    await expect(page.locator('aside .ReactVirtualized__Grid').first()).toBeVisible({
      timeout: 20000,
    });

    // settledSizes asserts the virtualized grid matches its container width.
    const initial = await settledSizes(page);

    // Collapse then re-expand the sidebar; the grid must re-measure back to its
    // container instead of keeping a stale width.
    await page.locator('aside').getByTestId('close-sidebar-button').click();
    await page.locator('aside').getByTestId('open-sidebar-button').click();

    const reopened = await settledSizes(page);
    expect(Math.abs(reopened.grid - initial.grid)).toBeLessThanOrEqual(1);

    // A shorter viewport shrinks the list height while it keeps tracking its container.
    await page.setViewportSize({ width: 1280, height: 540 });
    const shrunken = await settledSizes(page);
    expect(shrunken.gridH).toBeLessThan(initial.gridH);
  });

  test('the collapsed rail still reaches settings and sign-out', async ({ page }) => {
    await page.goto('/c/new', { timeout: 10000 });
    const rail = page.locator('aside');
    await expect(rail.getByTestId('close-sidebar-button')).toBeVisible({ timeout: 20000 });

    await rail.getByTestId('close-sidebar-button').click();
    await expect(rail.getByTestId('open-sidebar-button')).toBeVisible();

    /* Without the account button the rail is a dead end: the only way to
       settings or sign-out would be to expand the sidebar again. */
    await rail.getByTestId('nav-user').click();
    await expect(page.getByRole('menuitem', { name: /Настройки|Settings/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Выход|Log out/ })).toBeVisible();
  });

  /**
   * The list asks the server for 25 chats and fetches the next 25 when the
   * reader gets near the bottom. Nothing covered that: the row here used to
   * point at the width test above, which never scrolls and never counts.
   *
   * Thirty chats are written straight into the database rather than held one by
   * one, because what is under test is the fetching, not conversation creation
   * — and because a run that had to produce thirty replies first would take
   * minutes.
   *
   * The claim is pagination, so "the last chat is on screen" is not enough on
   * its own: a build that returned all thirty in one response would satisfy it
   * while paginating nothing. The test therefore requires a **second** request,
   * one carrying a cursor, and only then looks for the chat it should have
   * brought.
   */
  test('the chat list fetches the next page when you scroll to the end', async ({ page }) => {
    test.setTimeout(120000);
    const stamp = Date.now();
    const title = (index: number) => `E2E Page Convo ${String(index).padStart(2, '0')} ${stamp}`;
    const newest = title(0);
    const oldest = title(SEEDED_CONVERSATIONS - 1);

    applyRuntimeEnv();
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI must be available for the chat list pagination test');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

      const token = await getAccessToken(page);
      const me = await requestJson<{ id?: string; _id?: string }>(page, {
        path: '/api/user',
        token,
      });
      const userId = me.id ?? me._id;
      expect(userId).toBeTruthy();

      /* Dated an hour ahead so these sort above whatever earlier specs left
       * behind for this user, which is what makes "position 30" mean "page 2". */
      await client
        .db()
        .collection('conversations')
        .insertMany(
          Array.from({ length: SEEDED_CONVERSATIONS }, (_, index) => ({
            conversationId: randomUUID(),
            user: userId,
            title: title(index),
            endpoint: 'Mock Provider A',
            model: 'mock-model-a',
            isArchived: false,
            createdAt: new Date(stamp + 3600_000 - index * 1000),
            updatedAt: new Date(stamp + 3600_000 - index * 1000),
          })),
        );

      /* There is a second page to fetch — asserted from the server, before any
       * of it is blamed on the list. */
      const firstPage = await requestJson<{
        conversations?: { title: string }[];
        nextCursor?: string | null;
      }>(page, { path: '/api/convos?limit=25', token });
      expect(firstPage.conversations).toHaveLength(25);
      expect(firstPage.nextCursor).toBeTruthy();

      await page.reload({ timeout: 20000 });
      await expect(page.getByText(newest, { exact: true })).toBeVisible({ timeout: 20000 });

      /* Neither the last chat of the first page nor the one past it is on
       * screen yet. The first of the two is the control: it is already loaded
       * and merely below the fold, so if it does not appear after the scroll,
       * the scroll did not happen and the rest of this test means nothing.
       * Measured — an earlier version wheeled at fixed coordinates that missed
       * the list, scrollTop stayed 0 through fifteen turns, and it read exactly
       * like an app that refuses to paginate. */
      const lastOfFirstPage = title(20);
      await expect(page.getByText(lastOfFirstPage, { exact: true })).toHaveCount(0);
      await expect(page.getByText(oldest, { exact: true })).toHaveCount(0);

      const secondPage = page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.pathname === '/api/convos' && !!url.searchParams.get('cursor') && response.ok()
          );
        },
        { timeout: 30000 },
      );

      /* Aimed at the list, not at a coordinate: `hover` puts the pointer at the
       * element's own centre, which is what makes the wheel reach the
       * virtualized scroller. */
      const list = page.locator('.ReactVirtualized__List').first();
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await list.hover();
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(300);
        if ((await page.getByText(oldest, { exact: true }).count()) > 0) {
          break;
        }
      }

      await expect(page.getByText(lastOfFirstPage, { exact: true })).toBeVisible();
      await secondPage;
      await expect(page.getByText(oldest, { exact: true })).toBeVisible();
    } finally {
      await client
        .db()
        .collection('conversations')
        .deleteMany({ title: { $regex: `${stamp}$` } });
      await client.close();
    }
  });
});
