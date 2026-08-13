/** Static asset extensions that must 404 when missing — serving the SPA's
 * index.html for them breaks strict MIME checks and poisons SW/browser caches. */
const STATIC_ASSET_EXT =
  /\.(?:js|mjs|css|map|json|wasm|webmanifest|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot)$/i;

/** Where local file storage puts uploads. It is a storage prefix, not a served
 * route — downloads go through `/api/files/download/:userId/:file_id` — but a
 * stored `filepath` is rendered as a link `href`, so a middle-click or "Save
 * link as" on a file chip lands here. Answering with the SPA shell put an HTML
 * page in Downloads under the file's own name; a 404 says what happened.
 * Matched by prefix rather than by extension so it also covers the source
 * files, archives and extensionless names the sandbox produces. */
const STORAGE_PATH = /^\/uploads(?:\/|$)/;

/**
 * Creates the SPA fallback middleware: serves index.html for unmatched
 * routes while returning 404 for missing static assets.
 * @param {(req: import('express').Request, res: import('express').Response) => void} sendIndexHtml
 */
function createSpaFallback(sendIndexHtml) {
  return (req, res) => {
    if (STATIC_ASSET_EXT.test(req.path) || STORAGE_PATH.test(req.path)) {
      return res.status(404).end();
    }
    return sendIndexHtml(req, res);
  };
}

module.exports = createSpaFallback;
