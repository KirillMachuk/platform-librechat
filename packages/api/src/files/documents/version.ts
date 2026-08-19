/**
 * The stamp every preview document we generate carries, and the check that
 * reads it back.
 *
 * A rendered preview outlives the build that produced it: it is written onto
 * the file record and served from there, so a fix in a renderer never reaches
 * a document somebody already has. The serve path re-renders anything that
 * does not carry the current stamp.
 *
 * Bump `OFFICE_PREVIEW_VERSION` when the output changes in a way an older
 * document gets wrong — and expect one re-render per stored file, not one per
 * request: the serve path writes the refreshed document back.
 *
 * This lives in its own module because both `./html` and `./libreoffice`
 * build documents, and `./html` already imports `./libreoffice`.
 *
 * 2 — 18.08: the pptx wrap-and-scale pass measured the renderer's host box and
 *     clipped every slide after the first.
 */
export const OFFICE_PREVIEW_VERSION = '2';

/** Emitted into the `<head>` of every generated preview document. */
export const PREVIEW_VERSION_TAG = `<meta name="lc-office-preview" content="${OFFICE_PREVIEW_VERSION}">`;

/**
 * Read the stamp back. Matched by name and value rather than as a literal
 * substring: whitespace or a self-closing slash would otherwise stop us
 * recognising our own fresh documents, and the cost of that mistake is a
 * document that re-renders on every single request forever.
 */
const STAMP = /<meta\s+name=["']lc-office-preview["']\s+content=["']([^"']+)["']\s*\/?>/i;

/** True when `html` was produced by the current renderer. */
export function isCurrentOfficePreview(html: string): boolean {
  return STAMP.exec(html)?.[1] === OFFICE_PREVIEW_VERSION;
}
