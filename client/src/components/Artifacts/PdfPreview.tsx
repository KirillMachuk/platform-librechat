import { useRef, useState, useEffect } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { useLocalize } from '~/hooks';
import { logger } from '~/utils';

/**
 * Reads a PDF inside the panel instead of handing it to the browser's own
 * viewer. Chrome's viewer is good on a laptop and unusable on iOS: Safari
 * paints page one at its native width inside an iframe, with no scrolling and
 * no way to reach page two (owner report 17.08). Rendering the pages ourselves
 * gives one reading view — pages stacked, fitted to the panel, scrolled
 * vertically — on every device, and matches how a deck already reads.
 *
 * pdf.js and its worker are ~1.4 MB and load only when a PDF is actually
 * opened; the panel opens far more often without one.
 */

/** Pixel width change worth re-fitting for — an appearing scrollbar must not thrash. */
const REFIT_THRESHOLD = 8;

export default function PdfPreview({ url, title }: { url: string; title: string }) {
  const localize = useLocalize();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setReady(false);
    setFailed(false);

    (async () => {
      try {
        const [pdfjs, viewerLib, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/web/pdf_viewer.mjs'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        if (disposed) {
          return;
        }
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const eventBus = new viewerLib.EventBus();
        const linkService = new viewerLib.PDFLinkService({ eventBus });
        const pdfViewer = new viewerLib.PDFViewer({
          container,
          viewer,
          eventBus,
          linkService,
          textLayerMode: 1,
        });
        linkService.setViewer(pdfViewer);

        /* 'page-width' is the whole point on a phone: the page fits across and
           the reader scrolls down, never sideways. It has to be re-applied on
           every width change — the viewer keeps a numeric scale internally. */
        const fit = () => {
          pdfViewer.currentScaleValue = 'page-width';
        };
        eventBus.on('pagesinit', () => {
          fit();
          setReady(true);
        });

        const pdfDocument = await pdfjs.getDocument({ url }).promise;
        if (disposed) {
          pdfDocument.destroy();
          return;
        }
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);

        let lastWidth = container.clientWidth;
        const observer = new ResizeObserver(() => {
          if (Math.abs(container.clientWidth - lastWidth) < REFIT_THRESHOLD) {
            return;
          }
          lastWidth = container.clientWidth;
          fit();
        });
        observer.observe(container);

        cleanup = () => {
          observer.disconnect();
          pdfDocument.destroy();
        };
      } catch (err) {
        if (!disposed) {
          logger.error('[PdfPreview] Failed to render:', err);
          setFailed(true);
        }
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [url]);

  /* Both hosts stay mounted whatever happens. Swapping the container out on
     failure would leave the effect with nothing to attach to, and the next
     file opened in the same panel would inherit the fallback it never earned. */
  return (
    <div
      ref={containerRef}
      className="pan-x absolute inset-0 h-full overflow-x-auto overflow-y-auto bg-surface-secondary"
      aria-label={title}
      data-testid="pdf-preview"
    >
      <div ref={viewerRef} className="pdfViewer" hidden={failed} />
      {failed && (
        /* The browser's own viewer as the safety net: it is the only one that
           can ask for a password, so a protected file still opens. */
        <iframe src={url} title={title} className="absolute inset-0 h-full w-full border-0" />
      )}
      {!failed && !ready && (
        <div className="flex h-40 items-center justify-center">
          <span className="shimmer text-sm text-text-secondary">
            {localize('com_ui_preview_rendering')}
          </span>
        </div>
      )}
    </div>
  );
}
