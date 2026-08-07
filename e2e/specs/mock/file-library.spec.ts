import { expect, test } from '@playwright/test';
import { openFilesPanel } from './files.helpers';
import { NEW_CHAT_PATH } from './helpers';

/**
 * The library is one window.
 *
 * It used to be two, nested: the sidebar showed a short list — name and date,
 * nothing selectable — and a "Manage files" button opened a second dialog over
 * it with the same files, the columns that matter, and the only way to delete
 * anything. A person had to guess that the list they were looking at was not
 * the list.
 *
 * What this pins is the part a person meets: the columns the prototype fixes,
 * and that selecting and deleting live here rather than one window deeper.
 */
test.describe('the file library', () => {
  test('is one window, with the columns and the actions in it', async ({ page }) => {
    test.setTimeout(60000);
    /* The helper opens the panel from the sidebar; something has to put a page
       under it first, which every other spec does on its own way in. */
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    const panel = await openFilesPanel(page);

    /* The four the prototype fixes, in its order. Storage and context used to
       sit here too — the words the code uses about itself — and pushed Size off
       the edge of a 720 dialog. */
    /* By visible text, not by the `columnheader` role: a sortable header carries
       `role="button"` for the keyboard, which replaces the implicit one. The
       first version of this test asked for `columnheader` and found nothing —
       it would have passed forever on an empty table. */
    for (const column of ['Name', 'Search index', 'Size', 'Date']) {
      await expect(panel.getByText(column, { exact: true })).toBeVisible();
    }

    /* Selecting several files and deleting them is the reason the second window
       existed. It happens here now. */
    await expect(panel.getByRole('checkbox').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Delete' })).toBeVisible();

    /* And there is no way back into a second list, because there is not one. */
    await expect(panel.getByRole('button', { name: /Manage files/i })).toHaveCount(0);
  });
});
