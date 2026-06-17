import { EToolResources } from 'librechat-data-provider';

/**
 * Content signals used to route a document to whole-text `context` vs relevance
 * search (`file_search`/RAG). Routing keys off CONTENT size, not byte size: a
 * scanned PDF's bytes reflect image resolution, not how much text it holds, so
 * scans are sized by page count instead.
 */
export interface DocRoutingSignal {
  /** Characters of extractable text (digital text layer / parsed text); 0 if unknown. */
  textChars: number;
  /** Page count for paginated documents (PDFs); 0 when unknown / not paginated. */
  pageCount: number;
  /** True when the document has no extractable text layer (a scanned/image PDF). */
  isScanned: boolean;
}

/** Upper bounds for keeping a document in whole-text `context` mode. */
export interface DocRoutingThresholds {
  /** Max characters of extracted text to inline whole. */
  maxContextChars: number;
  /** Max pages for a scanned document to inline whole. */
  maxContextScanPages: number;
}

/** Moderate defaults (~8–10 pages of text / ~12 scanned pages); env-tunable. */
export const DEFAULT_DOC_ROUTING_THRESHOLDS: DocRoutingThresholds = {
  maxContextChars: 40_000,
  maxContextScanPages: 12,
};

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Whether content-based Auto routing is enabled. Off by default so the change
 * ships dormant and is switched on per-deployment after validation on lab.
 */
export const isContentRoutingEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.AUTO_ROUTE_BY_TEXT === 'true';

/** Reads {@link DocRoutingThresholds} from env, falling back to defaults. */
export const readDocRoutingThresholds = (
  env: NodeJS.ProcessEnv = process.env,
): DocRoutingThresholds => ({
  maxContextChars: positiveInt(
    env.AUTO_CONTEXT_MAX_CHARS,
    DEFAULT_DOC_ROUTING_THRESHOLDS.maxContextChars,
  ),
  maxContextScanPages: positiveInt(
    env.AUTO_CONTEXT_MAX_SCAN_PAGES,
    DEFAULT_DOC_ROUTING_THRESHOLDS.maxContextScanPages,
  ),
});

type WholeOrSearch = EToolResources.context | EToolResources.file_search;

/**
 * Route a document by content size: small documents go whole into the prompt
 * (`context`); larger ones go to relevance search (`file_search`). Scanned PDFs
 * are sized by page count, digital documents by character count. A scan whose
 * length is unknown (no page count) defaults to `file_search` — safer than
 * blocking the upload on a potentially huge synchronous OCR.
 */
export const routeDocumentBySize = (
  signal: DocRoutingSignal,
  thresholds: DocRoutingThresholds = DEFAULT_DOC_ROUTING_THRESHOLDS,
): WholeOrSearch => {
  const fitsWhole = signal.isScanned
    ? signal.pageCount > 0 && signal.pageCount <= thresholds.maxContextScanPages
    : signal.textChars <= thresholds.maxContextChars;
  return fitsWhole ? EToolResources.context : EToolResources.file_search;
};

/**
 * Average characters-per-page below which a PDF is treated as scanned (image)
 * rather than digital. Mirrors the doc-gateway classifier so the API server and
 * the OCR service agree on what "a scan" is.
 */
export const SCANNED_PDF_MAX_CHARS_PER_PAGE = 100;

/**
 * Classify a PDF as scanned (image-based) from its page count and the length of
 * its extractable text layer: a scan has pages but little/no text. Lets routing
 * size it by page count rather than by misleading byte size.
 */
export const isScannedPdf = (pageCount: number, textChars: number): boolean =>
  pageCount > 0 && textChars / pageCount < SCANNED_PDF_MAX_CHARS_PER_PAGE;

/**
 * Route a PDF from the raw outputs of a cheap pdfjs pass (page count + text-layer
 * length), deriving whether it is scanned. Digital PDFs route by character count,
 * scans by page count — see {@link routeDocumentBySize}.
 */
export const routePdfBySize = (
  pageCount: number,
  textChars: number,
  thresholds: DocRoutingThresholds = DEFAULT_DOC_ROUTING_THRESHOLDS,
): WholeOrSearch =>
  routeDocumentBySize(
    { textChars, pageCount, isScanned: isScannedPdf(pageCount, textChars) },
    thresholds,
  );
