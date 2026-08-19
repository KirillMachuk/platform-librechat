import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Artifact } from '~/common';
import FilePreviewBody from '../FilePreviewBody';

/**
 * The strip above a previewed document.
 *
 * It used to open with the file's type and size — the two things the reader can
 * already see (the name is in the panel header, the type is the document in
 * front of them) and the one nobody asked while reading. The owner asked for it
 * to go, and it did. What it must NOT take with it is the search context:
 * relevance and the pages that matched are the answer to "why is this file
 * here", and once the result card scrolls away this is the only place left
 * carrying it.
 */

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, values?: Record<string, string>): string =>
      values ? `${key}:${Object.values(values).join(',')}` : key,
}));

jest.mock('~/data-provider', () => ({
  useFileDownload: () => ({ refetch: jest.fn() }),
  useFilePreview: () => ({ data: undefined, isLoading: false, isError: false }),
}));

/* Kept out of the way: neither has anything to do with the strip, and both drag
   their own trees into a test that is about three lines of markup. */
jest.mock('~/components/Messages/Content/CopyButton', () => () => null);
jest.mock('~/components/icons', () => ({ Download: () => null }));

const buildArtifact = (preview: Record<string, unknown>): Artifact =>
  ({
    id: 'artifact-1',
    identifier: 'artifact-1',
    title: 'contract.pdf',
    type: 'application/vnd.librechat.docx-preview',
    file: { file_id: 'file-1', filename: 'contract.pdf' },
    preview: { fileType: 'application/pdf', bytes: 62_000, ...preview },
  }) as unknown as Artifact;

const renderBody = (artifact: Artifact) =>
  render(
    <RecoilRoot>
      <QueryClientProvider client={new QueryClient()}>
        <FilePreviewBody artifact={artifact} />
      </QueryClientProvider>
    </RecoilRoot>,
  );

describe('the strip above a previewed file', () => {
  it('is absent for a file opened on its own', () => {
    renderBody(buildArtifact({}));

    expect(screen.queryByTestId('file-preview-meta')).not.toBeInTheDocument();
  });

  it('carries relevance and the pages that matched when the file came from a search', () => {
    renderBody(
      buildArtifact({ relevance: 0.87, pages: [3, 7], pageRelevance: { 3: 0.9, 7: 0.4 } }),
    );

    const meta = screen.getByTestId('file-preview-meta');
    expect(meta).toHaveTextContent('87%');
    expect(meta).toHaveTextContent('3');
    expect(meta).toHaveTextContent('7');
  });

  it('says nothing about the size, which is what the strip was made of', () => {
    renderBody(buildArtifact({ relevance: 0.5 }));

    expect(screen.getByTestId('file-preview-meta')).not.toHaveTextContent(/KB|MB|62/);
  });
});
