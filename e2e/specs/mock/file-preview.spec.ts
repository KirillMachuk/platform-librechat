import { expect, test } from '@playwright/test';
import {
  MOCK_ENDPOINTS,
  NEW_CHAT_PATH,
  messagesView,
  replyPrompt,
  replyText,
  selectMockEndpoint,
  sendMessage,
} from './helpers';
import {
  attachFixture,
  chooseFixture,
  fileFixture,
  largeTextFixture,
  openFilesPanel,
  previewSurface,
  clickPreviewTab,
  previewFixture,
  previewFrame,
  previewFrameElement,
  pdfPage,
} from './files.helpers';

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
/** deck-many.pptx is built with this many slides — see e2e/fixtures/files/README.md. */
const DECK_MANY_SLIDES = 60;
const TEXT_TRUNCATED_NOTICE = 'Showing the beginning of a large file.';
/** `TEXT_PREVIEW_MAX_BYTES` in `client/src/components/Artifacts/FilePreviewBody.tsx`. */
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

test.describe('file library panel', () => {
  /**
   * The table comes from `@librechat/client`, which carries its own locale
   * file that this app does not load. When a key it asks for is undefined here,
   * i18next renders the key — so the search field announced itself to screen
   * readers as "com_ui_search_table". The unit guard is
   * `client/src/locales/keys.spec.ts`; this proves it in the running app.
   */
  test('labels the file table in words, not translation keys', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/c/new', { timeout: 15000 });
    const panel = await openFilesPanel(page);

    await expect(panel.getByRole('textbox', { name: 'Search table' })).toBeVisible();
    await expect(panel.getByText(/^com_[a-z0-9_]+$/)).toHaveCount(0);
  });
});

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

    await clickPreviewTab(frame, 'Сводка');
    await expect(body).toContainText(SHEET_TWO_MARKER, { useInnerText: true });
    await expect(body).not.toContainText(SHEET_MARKER, { useInnerText: true });

    await clickPreviewTab(frame, 'Реестр договоров');
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

  /* Names what this actually proves: a 423 KB document renders through the
   * server-side converter without timing out. Which renderer production would
   * have picked for it is a routing decision this profile disables, so no test
   * here can claim to cover the size bound. */
  test('renders a heavy document without timing out', async ({ page }) => {
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

    /* The pages, not an iframe: the browser's own viewer is still mounted as a
       fallback with the same title, so asserting on the frame would go green
       even if our renderer never ran. */
    await expect(pdfPage(page).first()).toBeVisible({ timeout: 30000 });
    await expect(previewSurface(page, 'digital.pdf').locator('pre')).toHaveCount(0);
  });

  /**
   * iOS Safari paints page one of an iframed PDF at its native width and
   * refuses to scroll, so a phone reader could not reach page two (owner
   * report 17.08). The fix is to render the pages ourselves and fit them
   * across; this pins both halves at phone width.
   */
  test('fits a PDF across a phone screen and scrolls down through it', async ({ page }) => {
    test.setTimeout(90000);
    /* Attached at desktop width on purpose: the phone composer keeps its attach
       control behind a menu, and this test is about the reading view, not about
       how a file gets in. The narrowing then also exercises the re-fit. */
    await previewFixture(page, 'digital.pdf');
    const viewer = page.getByTestId('pdf-preview');
    await expect(pdfPage(page).first()).toBeVisible({ timeout: 30000 });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(async () => (await pdfPage(page).first().boundingBox())?.width ?? 0, { timeout: 15000 })
      .toBeLessThanOrEqual(375);

    const fit = await viewer.evaluate((element) => {
      const page1 = element.querySelector('.page') as HTMLElement | null;
      return {
        pageWidth: page1?.getBoundingClientRect().width ?? 0,
        viewerWidth: element.clientWidth,
        scrollable: element.scrollHeight > element.clientHeight + 20,
        sideways: element.scrollWidth > element.clientWidth + 2,
      };
    });

    expect(fit.pageWidth).toBeGreaterThan(fit.viewerWidth * 0.8);
    expect(fit.pageWidth).toBeLessThanOrEqual(fit.viewerWidth);
    expect(fit.scrollable, 'the reader can scroll to the next page').toBe(true);
    expect(fit.sideways, 'nothing is reachable only by scrolling sideways').toBe(false);
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
   * A password-protected PDF is handed straight to the browser's own viewer,
   * which asks for the password inside the frame. The canon wants the shared
   * "could not show this document" state with Retry and Download, the same one
   * `locked.docx` already gets.
   *
   * Two tests, as everywhere else a known defect is pinned: a `test.fail` for
   * the state the canon asks for, and an ordinary one recording what happens
   * today. Without the pair, the day the redesign fixes this the single test
   * below would go red and read as a regression — the opposite of the truth.
   */
  test('a password-protected PDF says plainly it could not be shown', async ({ page }) => {
    test.fail();
    test.setTimeout(180000);
    const dialog = await previewFixture(page, 'locked.pdf');

    await expect(
      dialog.getByText(/Could not render preview for this file|Preview unavailable/),
    ).toBeVisible({ timeout: 60000 });
  });

  test('today a password-protected PDF stays in the browser viewer, inside the surface', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await previewFixture(page, 'locked.pdf');

    await expect(previewFrameElement(page, 'locked.pdf')).toBeVisible();
    /* 15.08-3: saving the file is the panel HEADER's job now (DownloadArtifact,
       which for a stored file saves the original bytes) — the body carries a
       download only on its honest-state plates, where there is no frame. */
    await expect(page.getByRole('button', { name: 'Download Artifact' })).toBeVisible();
  });
});

test.describe('file preview — the rest of the matrix', () => {
  test('renders a deck with many slides', async ({ page }) => {
    test.setTimeout(240000);
    await previewFixture(page, 'deck-many.pptx');

    const frame = previewFrame(page, 'deck-many.pptx');
    await expect(frame.locator('body')).toContainText(DECK_TITLE_MARKER, {
      timeout: 90000,
      useInnerText: true,
    });
    const slides = await frame.locator('.lc-pptx-slide').count();
    expect(slides).toBe(DECK_MANY_SLIDES);
  });

  test('opens a scanned PDF in the viewer even though it has no text layer', async ({ page }) => {
    test.setTimeout(120000);
    const dialog = await previewFixture(page, 'scan.pdf');

    await expect(pdfPage(page).first()).toBeVisible({ timeout: 30000 });
    await expect(dialog.locator('pre')).toHaveCount(0);
  });

  test('says plainly that a password-protected document could not be shown', async ({ page }) => {
    test.setTimeout(180000);
    const dialog = await previewFixture(page, 'locked.docx');

    await expect(
      dialog.getByText(/Could not render preview for this file|Preview unavailable/),
    ).toBeVisible({ timeout: 60000 });
    await expect(dialog.getByRole('button', { name: 'Download locked.docx' })).toBeVisible();
  });

  /**
   * A type the app cannot handle never reaches the library: the composer
   * refuses it in the browser, so there is no preview state to reach at all.
   */
  test('refuses a file type it cannot handle, before uploading it', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/c/new', { timeout: 15000 });

    const uploads: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/files')) {
        uploads.push(request.url());
      }
    });

    await chooseFixture(page, fileFixture('unknown.xyz'));

    /* The message is the synchronisation point. Asserting "no upload happened"
     * straight after the click would be true before anything could have been
     * sent, and would pass even if the file were accepted. */
    await expect(page.getByText(/cannot be attached here/)).toBeVisible({ timeout: 30000 });
    expect(uploads).toEqual([]);
  });

  /**
   * The other entry point the canon lists. It is covered by one small file on
   * purpose: a chip only exists after the model's turn completes, and a document
   * large enough to be interesting overflows the mock provider's context window
   * and kills the turn — which is why the rest of the matrix goes through the
   * library instead.
   */
  test('opens a preview from a file attached to a sent message', async ({ page }) => {
    test.setTimeout(120000);
    const fixture = fileFixture('notes.md');
    await page.goto(NEW_CHAT_PATH, { timeout: 15000 });
    await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
    await attachFixture(page, fixture);

    const response = await sendMessage(page, replyPrompt('transcript-preview'));
    expect(response.ok()).toBeTruthy();
    await expect(messagesView(page).getByText(replyText('transcript-preview'))).toBeVisible({
      timeout: 60000,
    });

    await messagesView(page).getByRole('button', { name: fixture.name, exact: true }).click();
    const dialog = previewSurface(page, fixture.name);
    await expect(dialog).toHaveCount(1);
    await expect(dialog.locator('pre')).toContainText(MD_MARKER, { timeout: 30000 });
  });

  test('shows the beginning of a very long text file and says so', async ({ page }) => {
    test.setTimeout(120000);
    const fixture = largeTextFixture('long-report.md', 600 * 1024);
    const dialog = await previewFixture(page, fixture);

    await expect(dialog.locator('pre')).toBeVisible({ timeout: 30000 });

    /* Against the cap, not against the whole file. "Shorter than the source"
     * was the old assertion and it could not fail: `innerText` trims at least
     * the trailing newline, so any prefix — including the entire file with
     * truncation switched off — is shorter than the source by at least one
     * character. Comparing to the cap is what makes the number mean something.
     *
     * The cap is a byte count and the text is Cyrillic at two bytes a
     * character, so the expected character count comes from slicing the
     * fixture's bytes and decoding, not from dividing. */
    const capped = fixture.buffer.subarray(0, TEXT_PREVIEW_MAX_BYTES).toString('utf8').length;
    const shown = (await dialog.locator('pre').innerText()).length;
    expect(shown).toBeLessThanOrEqual(capped);
    expect(shown).toBeGreaterThan(capped - 20);
    await expect(dialog.getByText(TEXT_TRUNCATED_NOTICE)).toBeVisible();
  });
});
