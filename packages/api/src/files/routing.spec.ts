import { EToolResources } from 'librechat-data-provider';
import {
  acceptOcrText,
  countTextWords,
  DEFAULT_DOC_ROUTING_THRESHOLDS,
  DEFAULT_IMAGE_OCR_MIN_WORDS,
  imageOcrMinWords,
  isContentRoutingEnabled,
  isImageOcrEnabled,
  isScannedPdf,
  looksLikeText,
  readDocRoutingThresholds,
  routeDocumentBySize,
  routePdfBySize,
  SCANNED_PDF_MAX_CHARS_PER_PAGE,
} from './routing';

const { context, file_search } = EToolResources;

/**
 * OCR output measured on five representative attachments, run through this
 * deployment's own OCR service. Every realistic screenshot lands far below the
 * 150 characters the gate used to demand, and the image with NO text at all
 * produced the MOST characters — which is why the gate counts words instead.
 */
const OCR_SAMPLES = {
  /** Contract screenshot, 3 lines — 110 chars, 10 words. */
  contract:
    'ДОГОВОР АРЕНДЫ №05-11\nг. Минск, 06 апреля 2021 г.\nАрендодатель передаёт нежилое помещение общей площадью 120 м',
  /** Table screenshot, 4 rows — 83 chars, 6 words. */
  table: 'Товар | Кол-во | Цена\nСтол | 2 | 1 340,00\nСтул | 6 | 1 120,50\nЛампа | 1 | 12 089,90',
  /** Chart with a title and axis labels — 39 chars, 7 words. */
  chart: 'Выручка 2026, млн руб.\nянв фев мар апр.',
  /** Whiteboard diagram, 4 boxes — empty under psm 3, 26 chars / 4 words under psm 6. */
  diagram: 'Заявка Прове Договор Отказ',
  /** Product photo with no text at all — 106 chars of Tesseract noise, 0 words. */
  noise:
    '_ о = oo о / о мо / о о о\n| ` ~ и — о .. \\ о о | 1 о\n_ о = oo о / о мо / о о\n. , о | о ~ о | ,, о | .. - ~',
} as const;

/** The character minimum the gate demanded before it was measured. */
const OLD_MIN_CHARS = 150;

describe('routeDocumentBySize', () => {
  it('keeps a small digital document in whole-text context', () => {
    expect(routeDocumentBySize({ textChars: 5_000, pageCount: 3, isScanned: false })).toBe(context);
  });

  it('routes a large digital document to file_search', () => {
    expect(routeDocumentBySize({ textChars: 200_000, pageCount: 80, isScanned: false })).toBe(
      file_search,
    );
  });

  it('sizes a scanned PDF by page count, not characters', () => {
    expect(routeDocumentBySize({ textChars: 0, pageCount: 8, isScanned: true })).toBe(context);
    expect(routeDocumentBySize({ textChars: 0, pageCount: 40, isScanned: true })).toBe(file_search);
  });

  it('ignores byte/char noise for scans (small text layer, many pages → search)', () => {
    expect(routeDocumentBySize({ textChars: 10, pageCount: 30, isScanned: true })).toBe(
      file_search,
    );
  });

  it('routes a scan of unknown length (0 pages) to file_search', () => {
    expect(routeDocumentBySize({ textChars: 0, pageCount: 0, isScanned: true })).toBe(file_search);
  });

  it('treats the char threshold as inclusive at the boundary', () => {
    const t = { maxContextChars: 100, maxContextScanPages: 2 };
    expect(routeDocumentBySize({ textChars: 100, pageCount: 0, isScanned: false }, t)).toBe(
      context,
    );
    expect(routeDocumentBySize({ textChars: 101, pageCount: 0, isScanned: false }, t)).toBe(
      file_search,
    );
  });
});

describe('readDocRoutingThresholds', () => {
  it('falls back to defaults when env is unset', () => {
    expect(readDocRoutingThresholds({})).toEqual(DEFAULT_DOC_ROUTING_THRESHOLDS);
  });

  it('reads positive integer overrides', () => {
    expect(
      readDocRoutingThresholds({
        AUTO_CONTEXT_MAX_CHARS: '60000',
        AUTO_CONTEXT_MAX_SCAN_PAGES: '20',
      }),
    ).toEqual({ maxContextChars: 60_000, maxContextScanPages: 20 });
  });

  it('ignores non-positive or non-numeric overrides', () => {
    expect(
      readDocRoutingThresholds({
        AUTO_CONTEXT_MAX_CHARS: '-5',
        AUTO_CONTEXT_MAX_SCAN_PAGES: 'abc',
      }),
    ).toEqual(DEFAULT_DOC_ROUTING_THRESHOLDS);
  });
});

describe('isContentRoutingEnabled', () => {
  it('is off by default (opt-in rollout)', () => {
    expect(isContentRoutingEnabled({})).toBe(false);
  });

  it('is on when AUTO_ROUTE_BY_TEXT=true', () => {
    expect(isContentRoutingEnabled({ AUTO_ROUTE_BY_TEXT: 'true' })).toBe(true);
  });
});

describe('isScannedPdf', () => {
  it('flags a many-page PDF with almost no text as scanned', () => {
    expect(isScannedPdf(20, 200)).toBe(true);
  });

  it('treats a text-rich PDF as digital', () => {
    expect(isScannedPdf(20, 80_000)).toBe(false);
  });

  it('uses ~100 chars/page as the boundary', () => {
    expect(isScannedPdf(10, 10 * SCANNED_PDF_MAX_CHARS_PER_PAGE)).toBe(false);
    expect(isScannedPdf(10, 10 * SCANNED_PDF_MAX_CHARS_PER_PAGE - 1)).toBe(true);
  });

  it('is not scanned when page count is unknown (0)', () => {
    expect(isScannedPdf(0, 0)).toBe(false);
  });
});

describe('routePdfBySize', () => {
  it('routes a short scanned PDF to whole-text context', () => {
    expect(routePdfBySize(8, 300)).toBe(context);
  });

  it('routes a long scanned PDF to file_search', () => {
    expect(routePdfBySize(40, 1_000)).toBe(file_search);
  });

  it('routes a small digital PDF to context and a large one to file_search', () => {
    expect(routePdfBySize(5, 6_000)).toBe(context);
    expect(routePdfBySize(120, 300_000)).toBe(file_search);
  });
});

describe('isImageOcrEnabled', () => {
  it('is off by default (opt-in rollout)', () => {
    expect(isImageOcrEnabled({})).toBe(false);
  });

  it('is on when AUTO_IMAGE_OCR=true', () => {
    expect(isImageOcrEnabled({ AUTO_IMAGE_OCR: 'true' })).toBe(true);
  });
});

describe('imageOcrMinWords', () => {
  it('defaults to DEFAULT_IMAGE_OCR_MIN_WORDS', () => {
    expect(imageOcrMinWords({})).toBe(DEFAULT_IMAGE_OCR_MIN_WORDS);
  });

  it('reads a positive override', () => {
    expect(imageOcrMinWords({ AUTO_IMAGE_OCR_MIN_WORDS: '5' })).toBe(5);
  });

  it('ignores non-positive overrides', () => {
    expect(imageOcrMinWords({ AUTO_IMAGE_OCR_MIN_WORDS: '0' })).toBe(DEFAULT_IMAGE_OCR_MIN_WORDS);
  });
});

describe('countTextWords', () => {
  it('counts runs of three or more letters, Cyrillic and Latin alike', () => {
    expect(countTextWords('Заявка Прове Договор Отказ')).toBe(4);
    expect(countTextWords('Revenue per quarter, mln')).toBe(4);
  });

  it('ignores digits, punctuation and one- or two-letter fragments', () => {
    expect(countTextWords('120 кв. м. № 05-11 | 2 | oo')).toBe(0);
  });

  it('counts nothing in OCR noise from an image with no text', () => {
    expect(countTextWords(OCR_SAMPLES.noise)).toBe(0);
  });

  it('separates every measured content shape from noise without overlap', () => {
    expect(countTextWords(OCR_SAMPLES.contract)).toBe(10);
    expect(countTextWords(OCR_SAMPLES.table)).toBe(6);
    expect(countTextWords(OCR_SAMPLES.chart)).toBe(7);
    expect(countTextWords(OCR_SAMPLES.diagram)).toBe(4);
  });
});

describe('looksLikeText', () => {
  it('accepts real OCR text (Cyrillic + Latin)', () => {
    expect(looksLikeText('ДОГОВОР АРЕНДЫ №05-11 г. Минск, 06 апреля 2021 г. Lease No. 5')).toBe(
      true,
    );
  });

  it('rejects binary-ish garbage (control chars)', () => {
    const garbage = String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8).repeat(20);
    expect(looksLikeText(garbage)).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(looksLikeText('')).toBe(false);
  });
});

describe('acceptOcrText', () => {
  const minWords = DEFAULT_IMAGE_OCR_MIN_WORDS;

  it('accepts a contract screenshot the old character minimum rejected', () => {
    expect(OCR_SAMPLES.contract.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(OCR_SAMPLES.contract, minWords)).toBe(true);
  });

  it('accepts a table screenshot', () => {
    expect(OCR_SAMPLES.table.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(OCR_SAMPLES.table, minWords)).toBe(true);
  });

  it('accepts a chart carrying only a title and axis labels', () => {
    expect(OCR_SAMPLES.chart.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(OCR_SAMPLES.chart, minWords)).toBe(true);
  });

  it('accepts a whiteboard diagram of four boxes', () => {
    expect(OCR_SAMPLES.diagram.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(OCR_SAMPLES.diagram, minWords)).toBe(true);
  });

  it('rejects OCR noise from an image with no text at all', () => {
    expect(acceptOcrText(OCR_SAMPLES.noise, minWords)).toBe(false);
  });

  it('rejects noise that carries more characters than accepted real content', () => {
    expect(OCR_SAMPLES.noise.length).toBeGreaterThan(OCR_SAMPLES.diagram.length);
    expect(acceptOcrText(OCR_SAMPLES.diagram, minWords)).toBe(true);
    expect(acceptOcrText(OCR_SAMPLES.noise, minWords)).toBe(false);
  });

  it('rejects text with fewer words than the minimum', () => {
    expect(acceptOcrText('Итого 120', minWords)).toBe(false);
  });

  it('still rejects binary garbage that carries enough words', () => {
    const garbage = `Договор аренды помещение${String.fromCharCode(0, 1, 2).repeat(80)}`;
    expect(countTextWords(garbage)).toBeGreaterThanOrEqual(minWords);
    expect(acceptOcrText(garbage, minWords)).toBe(false);
  });
});
