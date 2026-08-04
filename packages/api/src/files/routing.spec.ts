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
 * | sample          | words | density |
 * |-----------------|-------|---------|
 * | contract        |    10 |   0.777 |
 * | receipt (photo) |    41 |   0.479 |  <- least dense real content
 * | chart           |    10 |   0.585 |
 * | diagram         |    14 |   0.937 |
 * | price tag       |     3 |   0.550 |  <- too blurry to read: dense nonsense
 * | sensor grain    |     7 |   0.176 |  <- textless
 * | foliage         |     7 |   0.070 |  <- textless
 */
const OCR_SAMPLES = {
  /** Contract screenshot, 3 lines. */
  contract:
    'ДОГОВОР АРЕНДЫ №05-11\nг. Минск, 06 апреля 2021 г.\nАрендодатель передаёт нежилое помещение общей площадью 120 м',
  /** Photographed cash receipt — the least dense real content measured, 0.48. */
  receipt: "000 “АВТОКАФЕ”\n\nКассовый чек\n\n000 \"Автокафе\"\n127015, г,Москва, пл,\nСавеловского вокзала, дом 2\nМЕСТО РАСЧЕТОВ Павильон\nкар ‘rodent печёный\n\n115.00 * 1шт. = 115.00\nрастительное масло\n\nс 85.00 ж шт. = 85.00\n\nлук фри\nо. 85.00 * ит, = 85.00\nЗакусочный\n\n120.00 * 1шт, = 120.00\nЗакусочный\n\n120.00 ж 1шт. = 120.00\n\nкофе `американо 0.2\n100.00 ж lur. = 100.00\n\nморе\n\n160.00 * 1шт. = 160.00\nИТОГ =785.00\nБЕЗНАЛИЧНЫМИ 785.00\nСУММА БЕЗ НАС 785.00\nСНО:УСН доход-расход ПРИХОД\n\nКАССИР Прохорова М,\n\n888/25\n\n29.07.2025 46:36\nИНН 7705202538 For дм\nРН ККТ 0000502615061209 Чем\noH 7286440500094315\non 89523\non 608422087\n\nСПАСИБО",
  /** Screenshot of a chart: title and axis labels only. */
  chart: "Диалоги по времени\n\n1200]\n\nиюл. 28 июл. 29 июл. 30 июл. 31 авг. 1 авг. 2 авг. 3 авг. 4",
  /** Screenshot of a network diagram, English labels. */
  diagram: "Design console Order console Fabricate and deliver console\n\nOrder tower : .\nmaterial Deliver tower material\n12\n3 3",
} as const;

/**
 * A photographed price tag too blurry to read: OCR returns dense nonsense. Not
 * noise by density (0.55, higher than a real receipt) — it is caught by having
 * too few words, which is why both bars exist.
 */
const OCR_UNREADABLE = "С\n= 50...\n= cece (NAN ВАЛА";

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
    expect(readImageOcrThresholds({})).toEqual({ minWords: 6, minDensity: 0.4 });
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
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: '-0.5' }).minDensity).toBe(0.4);
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: '1.5' }).minDensity).toBe(0.4);
    expect(readImageOcrThresholds({ AUTO_IMAGE_OCR_MIN_DENSITY: 'abc' }).minDensity).toBe(0.4);
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
    expect(measureOcrText(OCR_SAMPLES.receipt).density).toBeCloseTo(0.479, 2);
    expect(measureOcrText(OCR_SAMPLES.chart).density).toBeCloseTo(0.585, 2);
    expect(measureOcrText(OCR_SAMPLES.diagram).density).toBeCloseTo(0.937, 2);
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
    ['photographed receipt', OCR_SAMPLES.receipt],
    ['chart with a title and axis labels', OCR_SAMPLES.chart],
    ['network diagram', OCR_SAMPLES.diagram],
  ])('accepts a %s', (_name, sample) => {
    expect(acceptOcrText(sample, thresholds)).toBe(true);
  });

  it('accepts content the old 150-character minimum threw away', () => {
    expect(OCR_SAMPLES.contract.length).toBeLessThan(OLD_MIN_CHARS);
    expect(OCR_SAMPLES.chart.length).toBeLessThan(OLD_MIN_CHARS);
    expect(acceptOcrText(OCR_SAMPLES.contract, thresholds)).toBe(true);
    expect(acceptOcrText(OCR_SAMPLES.chart, thresholds)).toBe(true);
  });

  it('rejects a photo too blurry to read, which density alone cannot catch', () => {
    const unreadable = measureOcrText(OCR_UNREADABLE);
    expect(unreadable.density).toBeGreaterThan(measureOcrText(OCR_SAMPLES.receipt).density);
    expect(unreadable.words).toBeLessThan(thresholds.minWords);
    expect(acceptOcrText(OCR_UNREADABLE, thresholds)).toBe(false);
  });

  it.each([
    ['foliage', OCR_NOISE.foliage],
    ['sensor grain', OCR_NOISE.grain],
  ])('rejects OCR noise from a photo of %s, however many words it seems to hold', (_n, noise) => {
    expect(measureOcrText(noise).words).toBeGreaterThan(0);
    expect(measureOcrText(noise).density).toBeLessThan(thresholds.minDensity);
    expect(acceptOcrText(noise, thresholds)).toBe(false);
  });

  it('rejects text with fewer words than the minimum however dense it is', () => {
    const fourWords = 'Заявка Проверка Договор Отказ';
    expect(measureOcrText(fourWords)).toMatchObject({ words: 4, density: 1 });
    expect(acceptOcrText(fourWords, thresholds)).toBe(false);
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
      acceptOcrMetrics({ words: 6, density: 0.4, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(true);
    expect(
      acceptOcrMetrics({ words: 5, density: 0.9, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(false);
    expect(
      acceptOcrMetrics({ words: 9, density: 0.39, texty: true }, DEFAULT_IMAGE_OCR_THRESHOLDS),
    ).toBe(false);
  });
});
