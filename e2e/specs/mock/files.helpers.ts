import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { NEW_CHAT_PATH } from './helpers';

export const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'fixtures', 'files');

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  py: 'text/x-python',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xyz: 'application/octet-stream',
  zip: 'application/zip',
};

export type FileFixture = { name: string; mimeType: string; buffer: Buffer };

/**
 * A text file built here rather than committed: the only interesting thing
 * about it is its size, and half a megabyte of filler in the repository would
 * be half a megabyte nobody ever reads.
 */
export function largeTextFixture(name: string, bytes: number): FileFixture {
  const line = 'Строка отчёта о выполненных работах за отчётный период.\n';
  const repeats = Math.ceil(bytes / Buffer.byteLength(line, 'utf8'));
  return {
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# Отчёт\n\n${line.repeat(repeats)}`, 'utf8'),
  };
}

/** Load a committed fixture from `e2e/fixtures/files` for `setFiles`. */
export function fileFixture(name: string): FileFixture {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(`no mime type mapped for fixture "${name}"`);
  }
  return { name, mimeType, buffer: fs.readFileSync(path.join(FIXTURE_DIR, name)) };
}

const composer = (page: Page) =>
  page.locator('form').filter({ has: page.getByRole('textbox', { name: 'Message input' }) });

const isUpload = (response: { url(): string; request(): { method(): string }; status(): number }) =>
  response.url().includes('/api/files') &&
  response.request().method() === 'POST' &&
  response.status() === 200;

/** Hand the fixture to the composer's file picker, without waiting for an upload. */
export async function chooseFixture(page: Page, fixture: FileFixture) {
  const chooserPromise = page.waitForEvent('filechooser');
  await composer(page).getByRole('button', { name: 'Attach Files' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
}

/** Upload the fixture through the composer, which persists it in the user's files. */
export async function attachFixture(page: Page, fixture: FileFixture) {
  const uploaded = page.waitForResponse(isUpload, { timeout: 60000 });
  await chooseFixture(page, fixture);
  expect((await uploaded).ok()).toBeTruthy();
  await expect(composer(page).getByRole('button', { name: fixture.name })).toBeVisible();
}

/** Sidebar entry that opens the file library, and the heading it puts on the panel. */
const FILES_PANEL_TITLE = 'Attach Files';

/**
 * Open the file library from the sidebar.
 *
 * Previews are opened from here rather than from a chat transcript on purpose.
 * A transcript chip only appears once a model turn completes, so every preview
 * assertion used to depend on the mock provider's context window — and a
 * document big enough to be worth testing is also big enough to overflow it,
 * which killed the turn before the chip existed. Uploading already persists the
 * file, so the library shows it with no model in the loop.
 */
export async function openFilesPanel(page: Page): Promise<Locator> {
  const panel = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: FILES_PANEL_TITLE }) });
  await page.locator('aside').getByRole('button', { name: FILES_PANEL_TITLE }).click();
  /* The dialog element itself is a zero-height positioning wrapper, so it never
   * counts as visible; its heading is what tells us the panel actually opened. */
  await expect(panel.getByRole('heading', { name: FILES_PANEL_TITLE })).toBeVisible();
  return panel;
}

/** The preview surface for one file — the artifacts panel's FILE_PREVIEW body
 *  (14.08-3: every non-image file opens in the right panel; the filename is
 *  the panel's single tab). Addressed by the body's aria-label so two files
 *  can never be confused. */
export const previewSurface = (page: Page, filename: string): Locator =>
  page.locator(`[data-testid="file-preview-body"][aria-label="Preview: ${filename}"]`);

/**
 * Office previews render into a sandboxed srcdoc iframe, so assertions about
 * document content go through the frame rather than the dialog body.
 */
export const previewFrame = (page: Page, filename: string): FrameLocator =>
  page.frameLocator(`iframe[title="Preview: ${filename}"]`);

export const previewFrameElement = (page: Page, filename: string): Locator =>
  page.locator(`iframe[title="Preview: ${filename}"]`);

/**
 * A page rendered by our own PDF viewer. The browser's viewer stays mounted as
 * a fallback under the same title, so PDF assertions go through the canvas the
 * renderer paints rather than through the frame.
 */
export const pdfPage = (page: Page): Locator =>
  page.locator('[data-testid="pdf-preview"] .page canvas');

const RENDERING_NOTICE = 'Rendering document, this may take a moment…';

/** Every terminal surface the dialog can settle on, whatever the file turns out to be. */
const PREVIEW_SETTLED =
  /Preview not available for this file type|Could not render preview|Preview unavailable|Preview took too long|File is too large to preview/;

/**
 * Find the file in the library and open its preview.
 *
 * The table paginates at six rows, so the file is located through the table's
 * own search rather than by scanning the first page — otherwise a test would
 * pass or fail depending on how many files earlier tests left behind.
 *
 * Readiness has to be a positive signal — some surface exists — rather than
 * "the rendering notice is not visible", which is equally true before the
 * notice has had a chance to appear and lets a slow machine start asserting
 * against an empty dialog.
 *
 * The wait is generous because the first office document of a run pays for
 * loading the conversion libraries; measured cold renders on a loaded laptop
 * take tens of seconds, while every later one lands in a few.
 */
export async function openPreview(page: Page, filename: string): Promise<Locator> {
  const panel = await openFilesPanel(page);
  /* Located by placeholder, not by accessible name. The field used to announce
   * itself as "com_ui_search_table" — the shared package's locale file is not
   * loaded by the app, so i18next rendered the key — and that is fixed. The
   * placeholder locator stays because this helper runs under every test in the
   * matrix and should not depend on the outcome of the localisation guard;
   * whether the label is right is that guard's job, not this one's. */
  await panel.getByPlaceholder('Search', { exact: true }).fill(filename);
  /* Rows carry role="button" because the table is clickable, so the file is
   * addressed through its row header instead. `.first()` keeps a retry that
   * re-uploads the same fixture from turning into a strict-mode failure. */
  const row = panel.getByRole('rowheader', { name: filename, exact: true }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.click();

  /* The library popover closes itself on row click — otherwise it would sit
   * as a modal lid on top of the panel it just opened. */
  await expect(panel.getByRole('heading', { name: FILES_PANEL_TITLE })).toHaveCount(0);

  /* A locator that matches nothing makes every later negative assertion pass
   * for free, so pin that exactly one surface is open. */
  const surface = previewSurface(page, filename);
  await expect(surface).toHaveCount(1);

  const settled = previewFrameElement(page, filename)
    /* A PDF renders into our own viewer now, not into a frame — its first
       painted page is the settle signal there. */
    .or(pdfPage(page))
    .or(surface.locator('pre'))
    .or(surface.getByText(PREVIEW_SETTLED));
  await expect(settled.first()).toBeVisible({ timeout: 120000 });
  await expect(surface.getByText(RENDERING_NOTICE)).toHaveCount(0);
  return surface;
}

/**
 * Click a tab inside an office preview frame (spreadsheet sheets, deck slides).
 *
 * Measured, not guessed: the raw `frame.getByText(...).click()` switched sheets
 * in 1 run of 3, while the identical sequence with two layout round-trips in
 * between switched them in 3 of 3. The frame keeps re-laying out for a beat
 * after its first paint — fonts land, table columns resolve — and a click
 * dispatched into that window is delivered at coordinates the label has
 * already vacated. Waiting for the label's box to stop moving is the sync
 * point that race needs; it is not padding against flakiness.
 */
export async function clickPreviewTab(frame: FrameLocator, name: string): Promise<void> {
  const tab = frame.getByText(name, { exact: true });
  await tab.waitFor({ state: 'visible', timeout: 30000 });
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await tab.boundingBox());
        const settled = previous === box;
        previous = box;
        return settled;
      },
      { timeout: 15000, intervals: [100, 100, 200, 200, 400] },
    )
    .toBe(true);
  await tab.click();
}

/** Upload the fixture and open its preview from the library. */
export async function previewFixture(page: Page, file: string | FileFixture): Promise<Locator> {
  const fixture = typeof file === 'string' ? fileFixture(file) : file;
  await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
  await attachFixture(page, fixture);
  return openPreview(page, fixture.name);
}
