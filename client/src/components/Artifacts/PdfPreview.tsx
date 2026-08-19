import { useRef, useState, useEffect } from 'react';
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
 * The browser's viewer stays as the safety net, and every way pdf.js can fail
 * routes back to it: it is the only thing that can ask for a password, and a
 * reader who gets the old behaviour is far better off than one watching a
 * spinner or a blank page.
 *
 * pdf.js, its worker and its stylesheet load only when a PDF is opened — the
 * panel opens far more often without one.
 */

/**
 * Vendored decoders, served from our own origin (`client/public/assets/pdfjs`,
 * guarded by `npm run check:pdfjs-assets`).
 *
 * pdf.js 5 moved JBIG2, JPEG2000 and colour-profile decoding into WebAssembly
 * and refuses to guess where those files are: without this the decoder throws
 * while painting a page — after the viewer has already reported itself ready —
 * and a scanned document comes out as blank sheets. Scans are most of what
 * this platform's users open.
 *
 * Not vendored, and worth knowing: `cMapUrl` (CJK encodings without embedded
 * fonts) and `standardFontDataUrl` (the base-14 fonts). Both cost megabytes and
 * neither has shown up in the documents here; a file that needs them renders
 * with substituted metrics rather than failing.
 */
const PDFJS_ASSET_PATH = '/assets/pdfjs/';

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
    const abort = new AbortController();
    setReady(false);
    setFailed(false);

    /** Every failure lands here, and every failure ends up in the browser's viewer. */
    const giveUp = (reason: unknown) => {
      if (disposed) {
        return;
      }
      logger.error('[PdfPreview] Falling back to the browser viewer:', reason);
      setFailed(true);
    };

    (async () => {
      try {
        const [pdfjs, viewerLib, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/web/pdf_viewer.mjs'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          /* Loaded here rather than at module scope on purpose: the stylesheet
             declares `color-scheme: light dark` on `:root`, and shipped in the
             main bundle that reached every screen — native controls and
             scrollbars followed the system scheme instead of the app's. */
          import('pdfjs-dist/web/pdf_viewer.css'),
        ]);
        if (disposed) {
          return;
        }
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const eventBus = new viewerLib.EventBus();
        const linkService = new viewerLib.PDFLinkService({
          eventBus,
          /* Without a target, a link inside the document navigates the TOP
             document: the app unloads, the conversation goes with it, and a
             half-typed message is lost. In an iframe that was impossible. */
          externalLinkTarget: viewerLib.LinkTarget.BLANK,
        });
        /* `abortSignal` is read by the viewer's constructor (it disconnects its
           own resize observer and scroll listener on abort) but is missing from
           the package's typings, so the option is spelled out here rather than
           cast away. */
        const viewerOptions: ConstructorParameters<typeof viewerLib.PDFViewer>[0] & {
          abortSignal?: AbortSignal;
        } = {
          container,
          viewer,
          eventBus,
          linkService,
          abortSignal: abort.signal,
        };
        const pdfViewer = new viewerLib.PDFViewer(viewerOptions);
        linkService.setViewer(pdfViewer);

        /* 'page-width' is the whole point on a phone: the page fits across and
           the reader scrolls down, never sideways. It has to be re-applied on
           every width change — the viewer keeps a numeric scale internally. */
        const fit = () => {
          pdfViewer.currentScaleValue = 'page-width';
        };
        eventBus.on('pagesinit', () => {
          if (disposed) {
            return;
          }
          fit();
          setReady(true);
        });
        /* A page can fail on its own long after the viewer said it was ready —
           a decoder it cannot run, a broken image. The event carries the error
           and nothing else reports it: without this the reader gets a white
           sheet and no way to tell it apart from an empty page. */
        eventBus.on('pagerendered', ({ error }: { error?: Error }) => {
          if (error) {
            giveUp(error);
          }
        });

        const loadingTask = pdfjs.getDocument({ url, wasmUrl: PDFJS_ASSET_PATH });
        const pdfDocument = await loadingTask.promise;
        if (disposed) {
          pdfDocument.destroy();
          return;
        }
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        /* `setDocument` is synchronous and swallows what happens next: it
           builds the first page in a promise of its own, and a document whose
           page tree is broken rejects it with nobody listening — the panel then
           shimmered forever. This is that listener. */
        pdfViewer.pagesPromise?.catch(giveUp);

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
          /* The signal takes the viewer's own scroll listener and resize
             observer off the container; without it they outlive the file.
             Nothing casts `null` into `setDocument` here — the typings do not
             allow it, and with the signal there is nothing left for it to do. */
          abort.abort();
          pdfDocument.destroy();
        };
      } catch (err) {
        giveUp(err);
      }
    })();

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      } else {
        abort.abort();
      }
    };
  }, [url]);

  /* Both hosts stay mounted whatever happens. Swapping the container out on
     failure would leave the effect with nothing to attach to, and the next
     file opened in the same panel would inherit the fallback it never earned. */
  return (
    <div
      ref={containerRef}
      /* `document` + a tab stop: a bare scrolling div is announced as nothing
         and, outside Chrome, cannot be scrolled from the keyboard at all. The
         iframe this replaced was both by default. */
      role="document"
      tabIndex={0}
      aria-label={title}
      className="pan-x absolute inset-0 h-full overflow-x-auto overflow-y-auto bg-surface-secondary"
      data-testid="pdf-preview"
    >
      <div ref={viewerRef} className="pdfViewer" hidden={failed} />
      {failed && (
        /* The browser's own viewer. Its own title, so a test — or a person
           reading the DOM — can tell a rendered document from a fallback. */
        <iframe
          src={url}
          title={`${title} (fallback)`}
          data-testid="pdf-preview-fallback"
          className="absolute inset-0 h-full w-full border-0"
        />
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
