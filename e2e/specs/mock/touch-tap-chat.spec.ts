import { expect, test, devices } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import { NEW_CHAT_PATH, getAccessToken, requestJson } from './helpers';
import { applyRuntimeEnv } from '../../setup/runtimeEnv';

/**
 * Owner 17.08-3, live iPhone regression: tapping a sidebar chat summoned the
 * ink tooltip INSTEAD of opening the chat (iOS treats an element whose
 * mouseover reveals content as hover-first), and the plate then stuck because
 * touch never delivers mouseleave. The root fix makes TooltipAnchor fully
 * inert under `(hover: none)`; this spec runs under iPhone emulation (which
 * makes that media query match in chromium) and pins both halves: the tap
 * NAVIGATES, and no tooltip ever mounts.
 */
test.use({ ...devices['iPhone 13'] });

test.describe('touch tap on a sidebar chat', () => {
  test('opens the chat and never summons the tooltip', async ({ page }) => {
    test.setTimeout(120000);
    const stamp = Date.now();
    const title = `E2E Touch Tap ${stamp} with a long tail the drawer cannot fit on one line`;

    applyRuntimeEnv();
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI must be available for the touch-tap test');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
      await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible({
        timeout: 20000,
      });

      const token = await getAccessToken(page);
      const me = await requestJson<{ id?: string; _id?: string }>(page, {
        path: '/api/user',
        token,
      });
      const userId = me.id ?? me._id;
      expect(userId).toBeTruthy();

      const conversationId = randomUUID();
      await client
        .db()
        .collection('conversations')
        .insertOne({
          conversationId,
          user: userId,
          title,
          endpoint: 'Mock Provider A',
          model: 'mock-model-a',
          isArchived: false,
          isTemporary: false,
          createdAt: new Date(stamp),
          updatedAt: new Date(stamp),
        });

      await page.reload({ timeout: 20000 });
      await page.getByTestId('open-sidebar-button').tap();
      const row = page.getByTestId('convo-item').filter({ hasText: `E2E Touch Tap ${stamp}` });
      await expect(row).toBeVisible({ timeout: 20000 });

      await row.tap();
      await expect(page).toHaveURL(new RegExp(conversationId), { timeout: 10000 });

      /* The negative half needs a sync point: the plate's show delay is 300ms,
       * so "no tooltip" is only a claim after that window has passed. */
      await page.waitForTimeout(700);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    } finally {
      await client
        .db()
        .collection('conversations')
        .deleteMany({ conversationId: { $exists: true }, title });
      await client.close();
    }
  });
});
