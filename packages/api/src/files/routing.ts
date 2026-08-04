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

/** A share in (0, 1]; anything outside that falls back rather than widening a gate. */
const positiveRatio = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(raw ?? '');
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
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

/** Thresholds an image's OCR output must clear to count as a document. */
export interface ImageOcrThresholds {
  /** Minimum words of three or more letters. */
  minWords: number;
  /** Minimum share of non-space characters that sit inside those words. */
  minDensity: number;
}

/**
 * Both numbers come from real Tesseract output, and each catches a failure the
 * other misses.
 *
 * `minDensity` catches a photo with no text on it. Swept over 60 runs across 15
 * textless images (foliage, sensor grain, gravel, bokeh, brickwork; every psm
 * mode), Tesseract hallucinates up to 31 "words" — more than a real diagram —
 * but the word-rich ones top out at 0.304 density. Ten real screenshots and
 * photos that were read properly bottom out at 0.479 (a photographed receipt).
 * 0.4 sits between, with room on both sides.
 *
 * `minWords` catches the opposite: a photo too blurry to read, where OCR
 * returns a handful of dense nonsense. A photographed price tag scored 3 words
 * at density 0.55 — density cannot tell that from a receipt at 0.48. Those same
 * ten real images bottom out at 10 words, so 6 sits clear of both sides.
 *
 * Neither bar alone is enough, and an image that misses either goes to the
 * vision path — which is the safer answer anyway: four boxes and some arrows
 * carry their meaning in the arrows, and the words alone would misrepresent it.
 */
export const DEFAULT_IMAGE_OCR_THRESHOLDS: ImageOcrThresholds = {
  minWords: 6,
  minDensity: 0.4,
};

/**
 * Whether Auto image-OCR is enabled. Off by default: images keep going natively
 * (vision) until a deployment opts in. When on, an uploaded image is OCR'd
 * locally and, if it yields enough real text, treated as a full-text document.
 */
export const isImageOcrEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.AUTO_IMAGE_OCR === 'true';

/** Reads {@link ImageOcrThresholds} from env, falling back to the measured defaults. */
export const readImageOcrThresholds = (
  env: NodeJS.ProcessEnv = process.env,
): ImageOcrThresholds => ({
  minWords: positiveInt(env.AUTO_IMAGE_OCR_MIN_WORDS, DEFAULT_IMAGE_OCR_THRESHOLDS.minWords),
  minDensity: positiveRatio(
    env.AUTO_IMAGE_OCR_MIN_DENSITY,
    DEFAULT_IMAGE_OCR_THRESHOLDS.minDensity,
  ),
});

/**
 * A word: three or more consecutive Latin/Cyrillic letters, combining marks
 * included so that a decomposed "März" or a stressed "Дире́ктор" stays one word.
 * Latin and Cyrillic because those are the OCR languages this deployment runs
 * (TESSERACT_LANGS); adding a language there means widening this class too.
 */
const OCR_WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Mn}]{3,}/gu;

/** What the gate measures in OCR output; also what the caller logs. */
export interface OcrTextMetrics {
  /** Words of three or more letters. */
  words: number;
  /** Share of non-space characters that sit inside those words, 0–1. */
  density: number;
  /** Whether the text looks like text at all rather than binary garbage. */
  texty: boolean;
}

const MIN_TEXT_RATIO = 0.7;
const TEXTY_CHARS = /[\p{L}\p{N}\s.,;:!?'"()[\]{}\-–—«»…/№%@#&*+=]/gu;
const WHITESPACE = /\s/gu;

/**
 * Heuristic: does this string look like real extracted text rather than binary
 * garbage? Guards the OCR path against a native fallback that read raw image
 * bytes as a string, or near-unreadable OCR — in those cases the caller prefers
 * the vision path.
 */
export const looksLikeText = (text: string): boolean => {
  const sample = text.slice(0, 4000);
  if (sample.length === 0) {
    return false;
  }
  const texty = (sample.match(TEXTY_CHARS) ?? []).length;
  return texty / sample.length >= MIN_TEXT_RATIO;
};

/**
 * Measure OCR output for the admission gate. `looksLikeText` runs first and on a
 * capped sample: it is the cheap guard, and it is what stops a native fallback
 * that read raw image bytes as a string from being scanned end to end.
 */
export const measureOcrText = (text: string): OcrTextMetrics => {
  const texty = looksLikeText(text);
  if (!texty) {
    return { words: 0, density: 0, texty };
  }
  const matches = text.match(OCR_WORD) ?? [];
  let inWords = 0;
  for (const word of matches) {
    inWords += word.length;
  }
  const nonSpace = text.replace(WHITESPACE, '').length;
  return { words: matches.length, density: nonSpace === 0 ? 0 : inWords / nonSpace, texty };
};

/**
 * Whether OCR output should be accepted as a document rather than fall back to
 * the vision path. Character count is not the quantity to gate on — the textless
 * image in the measurement produced the MOST characters — and neither is word
 * count on its own: noise from a photo of foliage yields more "words" than a
 * real diagram. Content is what has enough words AND enough of its text inside
 * them. Accepting replaces the picture with its text, so a wrong yes costs the
 * model the image itself; when in doubt this says no and vision still sees it.
 */
export const acceptOcrMetrics = (
  metrics: OcrTextMetrics,
  thresholds: ImageOcrThresholds,
): boolean =>
  metrics.texty && metrics.words >= thresholds.minWords && metrics.density >= thresholds.minDensity;

/** Convenience wrapper over {@link measureOcrText} + {@link acceptOcrMetrics}. */
export const acceptOcrText = (text: string, thresholds: ImageOcrThresholds): boolean =>
  acceptOcrMetrics(measureOcrText(text.trim()), thresholds);
