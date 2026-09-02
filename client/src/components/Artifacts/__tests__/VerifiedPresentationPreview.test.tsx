import React from 'react';
import { act, render, screen } from '@testing-library/react';
import VerifiedPresentationPreview from '../VerifiedPresentationPreview';

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
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['%PDF-1.7\nverified'], { type: 'application/octet-stream' }),
    })) as unknown as typeof fetch;

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
    ['an HTTP failure', { ok: false, blob: async () => new Blob(['%PDF-1.7']) }],
    ['non-PDF bytes', { ok: true, blob: async () => new Blob(['<html>wrong</html>']) }],
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
});
