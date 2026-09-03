import React from 'react';
import { act, render, screen } from '@testing-library/react';
import VerifiedPresentationPreview, { readBoundedPdf } from '../VerifiedPresentationPreview';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('../PdfPreview', () => ({
  __esModule: true,
  default: ({ url, title }: { url: string; title: string }) => (
    <div data-testid="pdf-preview">{`${title}:${url}`}</div>
  ),
}));

const originalFetch = global.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const PDF_MAGIC_BYTES = 5;

const bytes = (value: string) => Uint8Array.from(value, (character) => character.charCodeAt(0));

const streamingResponse = (chunks: string[], contentLength: string | null = null) => {
  const cancel = jest.fn(async () => undefined);
  const releaseLock = jest.fn();
  const read = jest.fn();
  chunks.forEach((chunk) => read.mockResolvedValueOnce({ done: false, value: bytes(chunk) }));
  read.mockResolvedValueOnce({ done: true, value: undefined });

  return {
    response: {
      ok: true,
      headers: { get: jest.fn(() => contentLength) },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    } as unknown as Response,
    cancel,
    read,
    releaseLock,
  };
};

describe('VerifiedPresentationPreview', () => {
  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:verified-preview');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('renders a PDF only after verifying its magic bytes', async () => {
    const { response } = streamingResponse(['%P', 'DF-1.7\nverified']);
    global.fetch = jest.fn(async () => response) as unknown as typeof fetch;

    await act(async () => {
      render(
        <VerifiedPresentationPreview
          url="/api/files/code/download/abcdefghijklmnopqrstu/123456789012345678901"
          title="deck.pptx"
          refreshKey={0}
          fallback={<div data-testid="fallback" />}
        />,
      );
    });

    expect(await screen.findByTestId('pdf-preview')).toHaveTextContent(
      'deck.pptx:blob:verified-preview',
    );
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
  });

  it.each([
    ['an HTTP failure', { ok: false }],
    ['non-PDF bytes', streamingResponse(['<html>wrong</html>']).response],
  ])('falls back to the legacy renderer for %s', async (_label, response) => {
    global.fetch = jest.fn(async () => response) as unknown as typeof fetch;

    await act(async () => {
      render(
        <VerifiedPresentationPreview
          url="/api/files/code/download/abcdefghijklmnopqrstu/123456789012345678901"
          title="deck.pptx"
          refreshKey={0}
          fallback={<div data-testid="fallback" />}
        />,
      );
    });

    expect(await screen.findByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-preview')).not.toBeInTheDocument();
  });

  it('cancels a chunked response as soon as the streaming byte limit is exceeded', async () => {
    const { response, cancel, read, releaseLock } = streamingResponse(['%PDF-', 'overflow']);

    await expect(readBoundedPdf(response, PDF_MAGIC_BYTES + 2)).rejects.toThrow(
      'Preview size is outside the accepted range',
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rejects a declared oversized response before reading its stream', async () => {
    const bodyCancel = jest.fn(async () => undefined);
    const response = {
      headers: { get: () => String(51 * 1024 * 1024) },
      body: { cancel: bodyCancel },
    } as unknown as Response;

    await expect(readBoundedPdf(response)).rejects.toThrow(
      'Preview size is outside the accepted range',
    );
    expect(bodyCancel).toHaveBeenCalledTimes(1);
  });
});
