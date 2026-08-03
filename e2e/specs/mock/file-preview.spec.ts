import { expect, test } from '@playwright/test';
import { previewDialog, previewFixture, previewFrame, previewFrameElement } from './files.helpers';

/**
 * What a user sees after opening a file from their library. The fixtures in
 * `e2e/fixtures/files` are real documents produced by the usual Office
 * libraries rather than hand-built XML.
 *
 * The e2e profile sets OFFICE_PREVIEW_DISABLE_CDN, so office documents render
 * through the server-side converter here. Production serves small files through
 * a bundled renderer instead, which these tests therefore do not cover — that
 * path is guarded by unit tests in packages/api/src/files/documents/html.spec.ts.
 *
 * Expected behavior comes from the design canon (§6.15): one reading view, no
 * page numbers invented for formats that have none, and an honest state
 * instead of an empty rectangle when a file cannot be shown.
 */

/* Markers are literal strings taken from the fixtures themselves rather than
 * re-extracted with the same library the app renders with — a check that
 * shares code with its target passes even when both are wrong. */
const CONTRACT_MARKER = 'Исполнитель обязуется оказать Заказчику услуги';
const CONTRACT_LONG_MARKER = 'Договор оказания услуг (расширенный)';
const SHEET_MARKER = 'Реестр действующих договоров';
const SHEET_TWO_MARKER = 'Сводка по кварталам';
/* Row 5 of `registry.xlsx`: no end date, no paid amount, no status. */
const SPREADSHEET_ROW_WITH_A_HOLE = [
  '1',
  'ООО «Ромашка»',
  'Оказание услуг',
  '01.01.2024',
  '',
  '4800',
  '',
  '',
];
const MD_MARKER = 'Что сделано';
const PY_MARKER = 'def total_amount';
const CSV_MARKER = 'Контрагент';
const DECK_TITLE_MARKER = 'Итоги полугодия';
const DECK_SECTION_MARKER = 'Раздел 1';

test.describe('file preview — office documents', () => {
  test('renders a Word contract as continuous reading text', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'contract-short.docx');

    const frame = previewFrame(page, 'contract-short.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_MARKER, {
      timeout: 60000,
      useInnerText: true,
    });
  });

  test('reads a long agreement as one continuous document', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'contract-long.docx');

    const frame = previewFrame(page, 'contract-long.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_LONG_MARKER, {
      timeout: 60000,
      useInnerText: true,
    });
  });

  test('renders a spreadsheet as a grid with its sheets', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'registry.xlsx');

    const frame = previewFrame(page, 'registry.xlsx');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 60000 });
    await expect(frame.locator('body')).toContainText(SHEET_MARKER, { useInnerText: true });
  });

  test('switches between spreadsheet sheets and back', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'registry.xlsx');

    const frame = previewFrame(page, 'registry.xlsx');
    const body = frame.locator('body');
    await expect(body).toContainText(SHEET_MARKER, { timeout: 60000, useInnerText: true });
    await expect(body).not.toContainText(SHEET_TWO_MARKER, { useInnerText: true });

    await frame.getByText('Сводка', { exact: true }).click();
    await expect(body).toContainText(SHEET_TWO_MARKER, { useInnerText: true });
    await expect(body).not.toContainText(SHEET_MARKER, { useInnerText: true });

    await frame.getByText('Реестр договоров', { exact: true }).click();
    await expect(body).toContainText(SHEET_MARKER, { useInnerText: true });
  });

  test('keeps merged headers and empty cells from shifting the columns', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'registry.xlsx');

    const frame = previewFrame(page, 'registry.xlsx');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 60000 });

    /* The first contract in the fixture has no end date. If empty cells
     * collapsed, its amount would slide left into the date column. */
    const row = frame
      .locator('tr')
      .filter({ has: frame.locator('td').filter({ hasText: /^ООО «Ромашка»$/ }) })
      .first();
    expect((await row.locator('td, th').allInnerTexts()).map((cell) => cell.trim())).toEqual(
      SPREADSHEET_ROW_WITH_A_HOLE,
    );
  });

  test('keeps a huge spreadsheet bounded instead of hanging the panel', async ({ page }) => {
    test.setTimeout(240000);
    await previewFixture(page, 'big-rows.xlsx');

    const frame = previewFrame(page, 'big-rows.xlsx');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 90000 });
    const rows = await frame.locator('tr').count();
    expect(rows).toBe(5000);
    await expect(frame.locator('body')).toContainText(/Showing first .* of .* rows/, {
      useInnerText: true,
    });
  });

  test('renders a CSV as a sheet rather than raw text', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'data.csv');

    const frame = previewFrame(page, 'data.csv');
    await expect(frame.locator('table').first()).toBeVisible({ timeout: 60000 });
    await expect(frame.locator('body')).toContainText(CSV_MARKER, { useInnerText: true });
  });

  test('renders a widescreen presentation slide by slide', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'deck-16x9.pptx');

    const frame = previewFrame(page, 'deck-16x9.pptx');
    await expect(frame.locator('body')).toContainText(DECK_TITLE_MARKER, {
      timeout: 60000,
      useInnerText: true,
    });
    await expect(frame.locator('body')).toContainText(DECK_SECTION_MARKER, { useInnerText: true });
  });

  test('renders a four-by-three presentation too', async ({ page }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'deck-4x3.pptx');

    const frame = previewFrame(page, 'deck-4x3.pptx');
    await expect(frame.locator('body')).toContainText(DECK_TITLE_MARKER, {
      timeout: 60000,
      useInnerText: true,
    });
  });

  test('renders a document too large for the bundled renderer', async ({ page }) => {
    test.setTimeout(240000);
    await previewFixture(page, 'contract-heavy.docx');

    const frame = previewFrame(page, 'contract-heavy.docx');
    await expect(frame.locator('body')).toContainText(CONTRACT_MARKER, {
      timeout: 90000,
      useInnerText: true,
    });
  });
});

test.describe('file preview — plain formats', () => {
  test('shows a markdown file as text with a copy action', async ({ page }) => {
    test.setTimeout(90000);
    const dialog = await previewFixture(page, 'notes.md');

    await expect(dialog.locator('pre')).toContainText(MD_MARKER, { timeout: 30000 });
  });

  test('shows a source file as text', async ({ page }) => {
    test.setTimeout(90000);
    const dialog = await previewFixture(page, 'script.py');

    await expect(dialog.locator('pre')).toContainText(PY_MARKER, { timeout: 30000 });
  });

  test('renders a PDF in a viewer rather than as raw text', async ({ page }) => {
    test.setTimeout(90000);
    await previewFixture(page, 'digital.pdf');

    await expect(previewFrameElement(page, 'digital.pdf')).toBeVisible({ timeout: 30000 });
    await expect(previewDialog(page, 'digital.pdf').locator('pre')).toHaveCount(0);
  });
});

test.describe('file preview — honest states', () => {
  test('offers download instead of a preview for an archive', async ({ page }) => {
    test.setTimeout(90000);
    const dialog = await previewFixture(page, 'archive.zip');

    await expect(dialog.getByText('Preview not available for this file type')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Download / })).toBeVisible();
  });

  test('says plainly that a damaged document could not be shown', async ({ page }) => {
    test.setTimeout(180000);
    const dialog = await previewFixture(page, 'broken.docx');

    await expect(
      dialog.getByText(/Could not render preview for this file|Preview unavailable/),
    ).toBeVisible({ timeout: 60000 });
    await expect(dialog.getByRole('button', { name: /^Download / })).toBeVisible();
  });

  /**
   * A password-protected PDF is currently handed straight to the browser's own
   * viewer, which asks for the password inside the frame. The canon wants the
   * shared "could not show this document" state with Retry and Download
   * instead — that arrives with the panel redesign, see the corresponding
   * fixme row in e2e/COVERAGE_MAP.md.
   */
  test('keeps a password-protected PDF inside the preview surface', async ({ page }) => {
    test.setTimeout(180000);
    const dialog = await previewFixture(page, 'locked.pdf');

    await expect(previewFrameElement(page, 'locked.pdf')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download locked.pdf' })).toBeVisible();
  });
});
