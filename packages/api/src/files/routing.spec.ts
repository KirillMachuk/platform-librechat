import { EToolResources } from 'librechat-data-provider';
import {
  acceptOcrMetrics,
  acceptOcrText,
  DEFAULT_DOC_ROUTING_THRESHOLDS,
  DEFAULT_IMAGE_OCR_THRESHOLDS,
  measureOcrText,
  readImageOcrThresholds,
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
 * Real Tesseract output (rus+eng), captured from two sets of images: ones that
 * should become documents, and ones that carry NO text at all and must never
 * become documents. Word count does not separate them — the foliage photo below
 * yields more "words" than a real whiteboard diagram. Word density does.
 *
 * | sample        | words | density |
 * |---------------|-------|---------|
 * | contract      |    10 |   0.777 |
 * | chart         |     7 |   0.781 |
 * | table         |     6 |   0.410 |  <- lowest content
 * | diagram       |     4 |   1.000 |
 * | sensor grain  |     7 |   0.176 |  <- textless
 * | foliage       |     7 |   0.070 |  <- textless
 * | empty scan    |     1 |   0.079 |  <- textless
 */
const OCR_SAMPLES = {
  /** Contract screenshot, 3 lines. */
  contract:
    'ДОГОВОР АРЕНДЫ №05-11\nг. Минск, 06 апреля 2021 г.\nАрендодатель передаёт нежилое помещение общей площадью 120 м',
  /** Table screenshot, 4 rows — the least dense content we still admit. */
  table: 'Товар | Кол-во | Цена\nСтол | 2 | 1 340,00\nСтул | 6 | 1 120,50\nЛампа | 1 | 12 089,90',
  /** Chart with a title and axis labels. */
  chart: 'Выручка 2026, млн руб.\nянв фев мар апр.',
  /** Whiteboard diagram, 4 boxes. */
  diagram: 'Заявка Проверка Договор Отказ',
} as const;

/** OCR of images with no text on them whatsoever — every one of these is noise. */
const OCR_NOISE = {
  /** Photo of foliage: 7 "words", none of them real. */
  foliage:
    '--„ ® : “os, et\n> = ->. ea? = кр Oe\nes: - ee Set = . ‘°F = Be = |\n2: eg 2:27: Le =. 24: ee\n> “eo Se & 2 2 2 * + oe” *- Se" — 7\n2 o° S° <. © 26 - о Oe ee\n> oe ee wt >> se % we, . "my oe\n- “te, <> "= Фа-з * sos ‘=>. - >\n2 a 5-5 ег\nа $ eek cd Soe\ni 222 oe ee -$ =>. _ ^^.\n\neo ”х & “oe < J а ee >\nae © 9B. %.- e ° es <> 9+.\n"i <= a = 5 == on + - < >\nfae Ра: eee\n+ ВЫ ле >,\nТЕ Pe ЗВ\n6 eee” Os 222°. 22. ме - "= © >...\n>>”. я © 9s © ce”. =. -9 “s\n_ = = +. о - _ Пт or',
  /** High-ISO sensor grain on a flat wall: 7 "words". */
  grain:
    'о - о о — ee о о о о о о о _ о о cel о т. о _ о _ о о о __ о ee ee — о\nо о о о о о _ о о fee о о о _ о о о о о Loe о о о\nо о о Bee о о о о о о о о о о cee о о о _ о о о\nо о о о soe о о о _ о о о о о о о о о о о nee о о',
} as const;

/** The character minimum the gate demanded before any of this was measured. */
const OLD_MIN_CHARS = 150;
const { minWords, minDensity } = DEFAULT_IMAGE_OCR_THRESHOLDS;

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

describe('readImageOcrThresholds', () => {
  it('falls back to the measured defaults when env is unset', () => {
    expect(readImageOcrThresholds({})).toEqual({ minWords: 3, minDensity: 0.3 });
  });

  it('reads overrides', () => {
    expect(
      readImageOcrThresholds({
        AUTO_IMAGE_OCR_MIN_WORDS: '5',
        AUTO_IMAGE_OCR_MIN_DENSITY: '0.45',
      }),
    ).toEqual({ minWords: 5, minDensity: 0.45 });
  });

  it('ignores overrides that would widen the gate past what was measured', () => {
    expect(
      readImageOcrThresholds({
        AUTO_IMAGE_OCR_MIN_WORDS: '0',
        AUTO_IMAGE_OCR_MIN_DENSITY: '0',
      }),
    ).toEqual(DEFAULT_IMAGE_OCR_THRESHOLDS);
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: '-0.5' }).minDensity).toBe(0.3);
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: '1.5' }).minDensity).toBe(0.3);
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: 'abc' }).minDensity).toBe(0.3);
  });
});

describe('measureOcrText', () => {
  it('counts runs of three or more letters, Cyrillic and Latin alike', () => {
    expect(measureOcrText('Заявка Проверка Договор Отказ').words).toBe(4);
    expect(measureOcrText('Revenue per quarter, mln').words).toBe(4);
  });

  it('ignores digits, punctuation and one- or two-letter fragments', () => {
    expect(measureOcrText('120 кв. м. № 05-11 | 2 | oo').words).toBe(0);
  });

  it('keeps a word whole when a combining mark sits inside it', () => {
    expect(measureOcrText('März'.normalize('NFD')).words).toBe(1);
    expect(measureOcrText('Дире́ктор').words).toBe(1);
  });

  it('reports the density of every measured content shape', () => {
    expect(measureOcrText(OCR_SAMPLES.contract)).toMatchObject({ words: 10, texty: true });
    expect(measureOcrText(OCR_SAMPLES.contract).density).toBeCloseTo(0.777, 2);
    expect(measureOcrText(OCR_SAMPLES.table).density).toBeCloseTo(0.41, 2);
    expect(measureOcrText(OCR_SAMPLES.chart).density).toBeCloseTo(0.781, 2);
    expect(measureOcrText(OCR_SAMPLES.diagram).density).toBe(1);
  });

  it('reports OCR noise as word-rich but sparse — which is how it is told apart', () => {
    const foliage = measureOcrText(OCR_NOISE.foliage);
    expect(foliage.words).toBeGreaterThanOrEqual(minWords);
    expect(foliage.density).toBeCloseTo(0.07, 2);
    const grain = measureOcrText(OCR_NOISE.grain);
    expect(grain.words).toBeGreaterThanOrEqual(minWords);
    expect(grain.density).toBeCloseTo(0.176, 2);
    expect(Math.max(foliage.density, grain.density)).toBeLessThan(minDensity);
  });

  it('does not scan text that failed the cheap texty guard', () => {
    const garbage = String.fromCharCode(0, 1, 2).repeat(80);
    expect(measureOcrText(garbage)).toEqual({ words: 0, density: 0, texty: false });
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
  const thresholds = DEFAULT_IMAGE_OCR_THRESHOLDS;

  it.each([
    ['contract screenshot', OCR_SAMPLES.contract],
    ['table screenshot', OCR_SAMPLES.table],
    ['chart with a title and axis labels', OCR_SAMPLES.chart],
    ['whiteboard diagram of four boxes', OCR_SAMPLES.diagram],
  ])('accepts a %s, which the old character minimum rejected', (_name, sample) => {
    expect(sample.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(sample, thresholds)).toBe(true);
  });

  it.each([
    ['foliage', OCR_NOISE.foliage],
    ['sensor grain', OCR_NOISE.grain],
  ])('rejects OCR noise from a photo of %s, however many words it seems to hold', (_n, noise) => {
    expect(measureOcrText(noise).words).toBeGreaterThan(measureOcrText(OCR_SAMPLES.diagram).words);
    expect(acceptOcrText(noise, thresholds)).toBe(false);
  });

  it('rejects text with fewer words than the minimum however dense it is', () => {
    const twoWords = 'Итого руб';
    expect(measureOcrText(twoWords)).toMatchObject({ words: 2, density: 1 });
    expect(acceptOcrText(twoWords, thresholds)).toBe(false);
  });

  it('still rejects binary garbage that carries enough words', () => {
    const garbage = `Договор аренды помещение${String.fromCharCode(0, 1, 2).repeat(80)}`;
    expect((garbage.match(/[\p{Script=Cyrillic}]{3,}/gu) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(acceptOcrText(garbage, thresholds)).toBe(false);
  });

  it('treats both thresholds as inclusive at the boundary', () => {
    const t = { minWords: 3, minDensity: 0.5 };
    expect(acceptOcrMetrics({ words: 3, density: 0.5, texty: true }, t)).toBe(true);
    expect(acceptOcrMetrics({ words: 2, density: 0.5, texty: true }, t)).toBe(false);
    expect(acceptOcrMetrics({ words: 3, density: 0.49, texty: true }, t)).toBe(false);
    expect(acceptOcrMetrics({ words: 3, density: 0.5, texty: false }, t)).toBe(false);
  });

  it('pins the defaults to the measured gap between content and noise', () => {
    expect(
      acceptOcrMetrics({ words: 3, density: 0.3, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(true);
    expect(
      acceptOcrMetrics({ words: 2, density: 0.9, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(false);
    expect(
      acceptOcrMetrics({ words: 9, density: 0.29, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(false);
  });
});
