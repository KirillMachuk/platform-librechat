import path from 'path';
import * as fs from 'fs';
import {
  MAX_OFFICE_PREVIEW_BYTES,
  OFFICE_PREVIEW_TIMEOUT_MS,
  isOfficeHtmlPreviewable,
  renderOfficePreview,
} from './ondemand';

const fixturesDir = __dirname;
const readFixture = (name: string): Buffer => fs.readFileSync(path.join(fixturesDir, name));

describe('renderOfficePreview', () => {
  test('renders a DOCX file into HTML with the mammoth fallback body present', async () => {
    const result = await renderOfficePreview(
      readFixture('sample.docx'),
      'sample.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result).toHaveProperty('html');
    if ('html' in result) {
      expect(result.bucket).toBe('docx');
      expect(result.html.length).toBeGreaterThan(0);
      expect(result.html).toContain('<article class="lc-docx">');
    }
  });

  test('renders an XLSX file into HTML', async () => {
    const result = await renderOfficePreview(
      readFixture('sample.xlsx'),
      'sample.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result).toHaveProperty('html');
    if ('html' in result) {
      expect(result.bucket).toBe('spreadsheet');
      expect(result.html.length).toBeGreaterThan(0);
    }
  });

  test('returns "unsupported" for a non-office filename and mime', async () => {
    const result = await renderOfficePreview(Buffer.from('hello world'), 'notes.txt', 'text/plain');
    expect(result).toEqual({ error: 'unsupported' });
  });

  test('returns "empty" for a zero-byte buffer', async () => {
    const result = await renderOfficePreview(
      Buffer.alloc(0),
      'empty.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result).toEqual({ error: 'empty' });
  });

  test('returns "too-large" when buffer exceeds the size cap', async () => {
    const oversized = Buffer.alloc(MAX_OFFICE_PREVIEW_BYTES + 1);
    const result = await renderOfficePreview(
      oversized,
      'huge.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result).toEqual({ error: 'too-large' });
  });

  test('exports a positive timeout constant', () => {
    expect(OFFICE_PREVIEW_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('isOfficeHtmlPreviewable', () => {
  test.each([
    ['doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['data.csv', 'text/csv'],
  ])('returns true for office filename %s', (filename, mime) => {
    expect(isOfficeHtmlPreviewable(filename, mime)).toBe(true);
  });

  test.each([
    ['image.png', 'image/png'],
    ['doc.pdf', 'application/pdf'],
    ['notes.md', 'text/markdown'],
    ['plain.txt', 'text/plain'],
  ])('returns false for non-office filename %s', (filename, mime) => {
    expect(isOfficeHtmlPreviewable(filename, mime)).toBe(false);
  });
});
