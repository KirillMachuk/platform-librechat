/** Static asset extensions that must 404 when missing — serving the SPA's
 * index.html for them breaks strict MIME checks and poisons SW/browser caches.
 *
 * Document extensions are here for a second reason: `/uploads/...` is not a
 * served route (downloads go through `/api/files/download/:userId/:file_id`),
 * so a stored `filepath` opened directly — a middle-click or "Save link as" on
 * a file chip — used to answer 200 with index.html and land in Downloads as a
 * .pptx that is really an HTML page. A 404 says what actually happened. */
const STATIC_ASSET_EXT =
  /\.(?:js|mjs|css|map|json|wasm|webmanifest|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|pptx?|potx|docx?|dotx|xlsx?|xltx|pdf|csv|tsv|zip|rtf|odt|ods|odp)$/i;

/**
 * Creates the SPA fallback middleware: serves index.html for unmatched
 * routes while returning 404 for missing static assets.
 * @param {(req: import('express').Request, res: import('express').Response) => void} sendIndexHtml
 */
function createSpaFallback(sendIndexHtml) {
  return (req, res) => {
    if (STATIC_ASSET_EXT.test(req.path)) {
      return res.status(404).end();
    }
    return sendIndexHtml(req, res);
  };
}

module.exports = createSpaFallback;
