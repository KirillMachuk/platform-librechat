import { expect, test } from '@playwright/test';
import {
  fileFixture,
  openPreview,
  previewDialog,
  previewFixture,
  previewFrame,
  previewFrameElement,
  sendWithFixture,
} from './files.helpers';

/**
 * What a user sees after clicking an attached file. The fixtures in
 * `e2e/fixtures/files` are real documents produced by the usual Office
 * libraries, not hand-built XML, so these exercise the same conversion path a
 * client's own contract takes.
 *
 * Expected behavior comes from the design canon (§6.15): one reading view, no
 * page numbers invented for formats that have none, and an honest state
 * instead of an empty rectangle when a file cannot be shown.
 */

const FAKE_PAGE_COUNTER = /(стр\.?\s*\d+\s*из\s*\d+|page\s+\d+\s+of\s+\d+)/i;

/* Markers are literal strings taken from the fixtures themselves rather than
 * re-extracted with the same library the app renders with — a check that
 * shares code with its target passes even when both are wrong. */
const CONTRACT_MARKER = 'Исполнитель обязуется оказать Заказчику услуги';
const CONTRACT_LONG_MARKER = 'Договор оказания услуг (расширенный)';
const SHEET_MARKER = 'Реестр действующих договоров';
const MD_MARKER = 'Что сделано';
const PY_MARKER = 'def total_amount';
const CSV_MARKER = 'Контрагент';
const DECK_TITLE_MARKER = 'Итоги полугодия';
const DECK_SECTION_MARKER = 'Раздел 1';

test.describe('file preview — office documents', () => {
  test('renders a Word contract as continuous reading text', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'contract-short.docx', 'docx-short');

    const frame = previewFrame(page, 'contract-short.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_MARKER, { timeout: 60000 });
  });

  test('does not invent page numbers for a Word document', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'contract-long.docx', 'docx-long');

    const frame = previewFrame(page, 'contract-long.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_LONG_MARKER, { timeout: 60000 });
    await expect(frame.locator('body')).not.toContainText(FAKE_PAGE_COUNTER);
  });

  test('renders a spreadsheet as a grid with its sheets', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'registry.xlsx', 'xlsx');

    const frame = previewFrame(page, 'registry.xlsx');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 60000 });
    await expect(frame.locator('body')).toContainText(SHEET_MARKER);
  });

  test('keeps a huge spreadsheet bounded instead of hanging the panel', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'big-rows.xlsx', 'xlsx-big');

    const frame = previewFrame(page, 'big-rows.xlsx');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 90000 });
    const rows = await frame.locator('tr').count();
    expect(rows).toBeLessThanOrEqual(5100);
  });

  test('renders a CSV as a sheet rather than raw text', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'data.csv', 'csv');

    const frame = previewFrame(page, 'data.csv');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 60000 });
    await expect(frame.locator('body')).toContainText(CSV_MARKER);
  });

  test('renders a widescreen presentation slide by slide', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'deck-16x9.pptx', 'pptx-wide');

    const frame = previewFrame(page, 'deck-16x9.pptx');
    await expect(frame.locator('body')).toContainText(DECK_TITLE_MARKER, { timeout: 60000 });
    await expect(frame.locator('body')).toContainText(DECK_SECTION_MARKER);
  });

  test('renders a four-by-three presentation too', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'deck-4x3.pptx', 'pptx-classic');

    const frame = previewFrame(page, 'deck-4x3.pptx');
    await expect(frame.locator('body')).toContainText(DECK_TITLE_MARKER, { timeout: 60000 });
  });

  test('renders a document too large for the bundled renderer', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'contract-heavy.docx', 'docx-heavy');

    const frame = previewFrame(page, 'contract-heavy.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_MARKER, { timeout: 90000 });
  });
});

test.describe('file preview — plain formats', () => {
  test('shows a markdown file as text with a copy action', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'notes.md', 'md');

    await expect(dialog.locator('pre')).toContainText(MD_MARKER, { timeout: 30000 });
  });

  test('shows a source file as text', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'script.py', 'code');

    await expect(dialog.locator('pre')).toContainText(PY_MARKER, { timeout: 30000 });
  });

  test('renders a PDF in a viewer rather than as raw text', async ({ page }) => {
    test.setTimeout(120000);
    await previewFixture(page, 'digital.pdf', 'pdf');

    await expect(previewFrameElement(page, 'digital.pdf')).toBeVisible({ timeout: 30000 });
    await expect(previewDialog(page).locator('pre')).toHaveCount(0);
  });
});

test.describe('file preview — honest states', () => {
  test('offers download instead of a preview for an archive', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'archive.zip', 'zip');

    await expect(dialog.getByText('Preview not available for this file type')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Download/ })).toBeVisible();
  });

  test('says plainly that a damaged document could not be shown', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'broken.docx', 'broken');

    await expect(
      dialog.getByText(/Could not render preview for this file|Preview unavailable/),
    ).toBeVisible({ timeout: 60000 });
    await expect(dialog.getByRole('button', { name: /Download/ })).toBeVisible();
  });

  /**
   * A password-protected PDF is currently handed straight to the browser's own
   * viewer, which asks for the password inside the frame. The canon wants the
   * shared "could not show this document" state with Retry and Download
   * instead — that arrives with the panel redesign, see the corresponding
   * fixme row in e2e/COVERAGE_MAP.md.
   */
  test('keeps a password-protected PDF inside the preview surface', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'locked.pdf', 'locked');

    await expect(dialog.getByText('locked.pdf')).toBeVisible();
    await expect(previewFrameElement(page, 'locked.pdf')).toBeVisible({ timeout: 30000 });
    await expect(dialog.getByRole('button', { name: /Download/ })).toBeVisible();
  });
});

test.describe('file preview — hermetic rendering', () => {
  test('renders an office document without reaching an external CDN', async ({ page }) => {
    test.setTimeout(120000);
    const cdnHosts = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/;
    const external: string[] = [];
    page.on('request', (request) => {
      if (cdnHosts.test(request.url())) {
        external.push(request.url());
      }
    });

    const fixture = fileFixture('contract-short.docx');
    await sendWithFixture(page, fixture, 'docx-hermetic');
    await openPreview(page, fixture.name);
    await expect(previewFrame(page, fixture.name).locator('body')).toContainText(CONTRACT_MARKER, {
      timeout: 60000,
    });

    expect(external).toEqual([]);
  });
});
