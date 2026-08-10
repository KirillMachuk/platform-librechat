import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom';
import { Tools } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TAttachment } from 'librechat-data-provider';
import { AttachmentGroup } from '~/components/Chat/Messages/Content/Parts/Attachment';
import { useSearchResultsByTurn } from '~/hooks/Messages/useSearchResultsByTurn';
import Sources from '~/components/Web/Sources';
import { SearchContext } from '~/Providers';

/* Downloading is the file card's click action and needs the API; the panel's job — showing
 * WHICH documents the answer stands on — does not. */
jest.mock('~/data-provider', () => ({
  useFileDownload: () => ({ refetch: jest.fn() }),
}));

/**
 * The panel under an answer, fed by the artifact `open_document` emits after a successful read.
 * The server builds this list from the reads that actually happened, so this test is the client
 * half of that promise: a document the model read end to end has to be visible as a source, the
 * same as one the search found.
 *
 * The whole client chain runs for real — the attachment goes through `useSearchResultsByTurn`
 * into the `Sources` panel — because the two places this can silently break are both in that
 * chain: a read carries NO page numbers and no retrieval score, and either could be treated as
 * "nothing to show" on the way through.
 */
const readAttachment = (fileId: string, fileName: string): TAttachment =>
  ({
    type: Tools.file_search,
    [Tools.file_search]: {
      sources: [
        {
          type: 'file',
          fileId,
          fileName,
          content: 'Договор аренды №312/24. 14.7. Односторонний отказ допускается за 30 дней.',
          relevance: 1,
          pages: [],
          pageRelevance: {},
        },
      ],
    },
    toolCallId: 'call-1',
    messageId: 'm1',
    conversationId: 'c1',
    name: 'file_search_results',
  }) as unknown as TAttachment;

function Panel({ attachments }: { attachments: TAttachment[] }) {
  const searchResults = useSearchResultsByTurn(attachments);
  return (
    <SearchContext.Provider value={{ searchResults }}>
      <Sources messageId="m1" conversationId="c1" />
    </SearchContext.Provider>
  );
}

const renderPanel = (attachments: TAttachment[]) =>
  render(
    <RecoilRoot>
      <QueryClientProvider client={new QueryClient()}>
        <Panel attachments={attachments} />
      </QueryClientProvider>
    </RecoilRoot>,
  );

describe('sources panel — documents the model read', () => {
  it('shows a document that was read in full', async () => {
    renderPanel([readAttachment('file-1', 'Договор аренды.pdf')]);

    expect(await screen.findByText('Договор аренды.pdf')).toBeInTheDocument();
  });

  /* Reading a long contract takes several calls, each its own tool result and its own
   * attachment. The panel must still say ONE document — a list repeating the same contract
   * four times reads as four separate sources under the answer. */
  it('lists a document read across several calls once', async () => {
    renderPanel([
      readAttachment('file-1', 'Договор аренды.pdf'),
      readAttachment('file-1', 'Договор аренды.pdf'),
    ]);

    expect(await screen.findAllByText('Договор аренды.pdf')).toHaveLength(1);
  });

  it('shows every document when the answer stands on more than one', async () => {
    renderPanel([
      readAttachment('file-1', 'Договор аренды.pdf'),
      readAttachment('file-2', 'Допсоглашение №1.pdf'),
    ]);

    expect(await screen.findByText('Договор аренды.pdf')).toBeInTheDocument();
    expect(await screen.findByText('Допсоглашение №1.pdf')).toBeInTheDocument();
  });

  /* No attachment, no panel: an empty "Sources" heading under an answer that used no
   * documents claims a provenance the answer does not have. */
  it('shows nothing when no document was read', () => {
    const { container } = renderPanel([]);

    expect(container).toBeEmptyDOMElement();
  });

  /* The read also puts an attachment on its own tool-call block, which routes through the
   * file-chip renderer for the first time — `library_search` results never reach it, they
   * render inside the retrieval card. A source card is not a downloadable file and must add
   * no chip: a blank chip under "Читаю документ" is noise the user cannot click or explain.
   * What keeps it out is that the artifact carries no file path — give it one and this fails. */
  it('adds no file chip under the tool call that produced it', () => {
    const { container } = render(
      <RecoilRoot>
        <QueryClientProvider client={new QueryClient()}>
          <AttachmentGroup attachments={[readAttachment('file-1', 'Договор аренды.pdf')]} />
        </QueryClientProvider>
      </RecoilRoot>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
