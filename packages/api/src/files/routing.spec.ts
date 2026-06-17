import { EToolResources } from 'librechat-data-provider';
import {
  DEFAULT_DOC_ROUTING_THRESHOLDS,
  isContentRoutingEnabled,
  isScannedPdf,
  readDocRoutingThresholds,
  routeDocumentBySize,
  routePdfBySize,
  SCANNED_PDF_MAX_CHARS_PER_PAGE,
} from './routing';

const { context, file_search } = EToolResources;

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
