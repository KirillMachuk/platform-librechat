import React, { memo, useMemo } from 'react';

/**
 * Renders a `static` artifact in a sandboxed iframe of our own, instead of
 * handing it to Sandpack.
 *
 * Why this exists: Sandpack's static template renders inside an iframe served
 * from `*.sandpack-static-server.codesandbox.io`. Measured on the stand,
 * opening one artifact made seven requests to that origin plus a Cloudflare
 * RUM beacon — and the document being previewed was inside a third party's
 * frame while their scripts ran in it. The `static` bucket is not exotic: it
 * is every HTML artifact, every markdown and code artifact, and every DOCX,
 * XLSX and PPTX preview. On a corporate stand that means the client's own
 * documents.
 *
 * `sandbox="allow-scripts"` WITHOUT `allow-same-origin` is the whole security
 * argument: the frame gets an opaque origin, so scripts inside an artifact can
 * animate a chart but cannot read our cookies, our localStorage or the parent
 * DOM. The two must never be combined — together they let the frame remove its
 * own sandbox attribute.
 *
 * Nothing here reaches the network unless the artifact's own markup asks for
 * it; the Tailwind runtime is served from our origin (see `tailwindTag`).
 */

/** Served from our own origin — see `client/public/assets/tailwind-3.4.17.js`
 *  and the note in `docs/artifacts-offline.md`. */
const TAILWIND_LOCAL_SRC = '/assets/tailwind-3.4.17.js';

/** A document that already loads Tailwind (the backend's office previews ship
 *  their own styles) must not get a second copy. */
const wantsTailwind = (html: string) =>
  /\bclass\s*=\s*["'][^"']*\b(?:flex|grid|text-|bg-|p[xytblr]?-|m[xytblr]?-|w-|h-|rounded|border|shadow)/.test(
    html,
  ) && !/tailwind/i.test(html);

const withTailwind = (html: string) => {
  if (!wantsTailwind(html)) {
    return html;
  }
  const tag = `<script src="${TAILWIND_LOCAL_SRC}"></script>`;
  /* Prefer the document's own head; a fragment without one still works —
     browsers hoist a leading <script> into the head they synthesise. */
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}\n${tag}`);
  }
  return `${tag}\n${html}`;
};

export const StaticPreview = memo(function StaticPreview({
  html,
  title,
}: {
  html: string;
  title: string;
}) {
  const srcDoc = useMemo(() => withTailwind(html), [html]);

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      /* allow-scripts alone: an opaque origin the artifact cannot escape.
         Adding allow-same-origin here would hand it our cookies. */
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-white"
    />
  );
});

export default StaticPreview;
