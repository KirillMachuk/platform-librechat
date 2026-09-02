import { useEffect, useState } from 'react';
import PdfPreview from './PdfPreview';
import { useLocalize } from '~/hooks';

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = '%PDF-';

const readBlobBytes = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read preview bytes'));
    reader.readAsArrayBuffer(blob);
  });

type Props = {
  url: string;
  title: string;
  refreshKey: number;
  fallback: React.ReactNode;
};

/**
 * Load the LibreOffice render emitted by the presentation skill. The path is
 * already constrained by the shared artifact-report schema, but the response
 * is still bounded and checked for PDF magic bytes before it reaches pdf.js.
 */
export default function VerifiedPresentationPreview({ url, title, refreshKey, fallback }: Props) {
  const localize = useLocalize();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setFailed(false);

    (async () => {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',
          signal: abort.signal,
        });
        if (!response.ok) {
          throw new Error(`Preview request failed with status ${response.status}`);
        }
        const blob = await response.blob();
        if (blob.size < PDF_MAGIC.length || blob.size > MAX_PREVIEW_BYTES) {
          throw new Error('Preview size is outside the accepted range');
        }
        const header = new Uint8Array(await readBlobBytes(blob.slice(0, PDF_MAGIC.length)));
        if (String.fromCharCode(...header) !== PDF_MAGIC) {
          throw new Error('Preview response is not a PDF');
        }
        if (abort.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setPreviewUrl(objectUrl);
      } catch {
        if (!abort.signal.aborted) {
          setFailed(true);
        }
      }
    })();

    return () => {
      abort.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [refreshKey, url]);

  if (failed) {
    return fallback;
  }
  if (previewUrl) {
    return <PdfPreview url={previewUrl} title={title} />;
  }
  return (
    <div className="flex h-full items-center justify-center bg-surface-secondary">
      <span className="shimmer text-sm text-text-secondary">
        {localize('com_ui_preview_rendering')}
      </span>
    </div>
  );
}
