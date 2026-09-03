import { useEffect, useState } from 'react';
import PdfPreview from './PdfPreview';
import { useLocalize } from '~/hooks';

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = '%PDF-';

const cancelReader = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  try {
    await reader.cancel();
  } catch {
    // The request may already have been aborted or the stream may already be closed.
  }
};

export const readBoundedPdf = async (
  response: Response,
  maxBytes = MAX_PREVIEW_BYTES,
): Promise<Blob> => {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Preview size is outside the accepted range');
    }
  }

  if (!response.body) {
    throw new Error('Preview response has no body');
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  const expectedHeader = Array.from(PDF_MAGIC, (character) => character.charCodeAt(0));
  let bytesRead = 0;
  let headerBytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value?.byteLength) {
        continue;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await cancelReader(reader);
        throw new Error('Preview size is outside the accepted range');
      }

      for (const byte of value) {
        if (headerBytesRead >= expectedHeader.length) {
          break;
        }
        if (byte !== expectedHeader[headerBytesRead]) {
          await cancelReader(reader);
          throw new Error('Preview response is not a PDF');
        }
        headerBytesRead += 1;
      }
      const chunk = new ArrayBuffer(value.byteLength);
      new Uint8Array(chunk).set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (headerBytesRead < expectedHeader.length) {
    throw new Error('Preview size is outside the accepted range');
  }

  return new Blob(chunks, { type: 'application/pdf' });
};

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
        const blob = await readBoundedPdf(response);
        if (abort.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
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
