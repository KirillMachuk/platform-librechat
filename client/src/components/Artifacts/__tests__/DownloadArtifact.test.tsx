import React from 'react';
import { RecoilRoot } from 'recoil';
import { dataService, FileSources } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Artifact } from '~/common';
import { EditorProvider, useCodeState } from '~/Providers/EditorContext';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import DownloadArtifact from '../DownloadArtifact';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string): string =>
      key,
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: { ...actual.dataService, getFileDownload: jest.fn() },
  };
});

const getFileDownload = dataService.getFileDownload as jest.Mock;

const buildArtifact = (overrides: Partial<Artifact> = {}): Artifact =>
  ({
    id: 'artifact-1',
    identifier: 'artifact-1',
    title: 'notes.md',
    type: TOOL_ARTIFACT_TYPES.MARKDOWN,
    content: 'original content',
    lastUpdateTime: 1,
    ...overrides,
  }) as Artifact;

const EDIT_LABEL = 'edit';
const EDITED_TEXT = 'content the user edited';

function EditBuffer() {
  const { setCurrentCode } = useCodeState();
  return (
    <button type="button" aria-label={EDIT_LABEL} onClick={() => setCurrentCode(EDITED_TEXT)} />
  );
}

/* jsdom's Blob does not expose its contents, so the constructor is wrapped to
 * record what the component actually put into the downloaded file. `null`
 * distinguishes "never built a Blob" from "built an empty one" — the earlier
 * `''` sentinel matched the reset value, so asserting on it proved nothing. */
const OriginalBlob = global.Blob;
let downloadedContent: string | null = null;
let downloadedName: string | undefined;
let clickSpy: jest.SpyInstance;

const renderDownload = (artifact: Artifact) =>
  render(
    <RecoilRoot initializeState={(snap) => snap.set(store.user, { id: 'current-user' } as never)}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditorProvider>
          <EditBuffer />
          <DownloadArtifact artifact={artifact} />
        </EditorProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );

/** A .pptx the sandbox produced: the panel shows a generated HTML preview,
 * the deliverable is the stored binary. */
const presentationArtifact = (): Artifact =>
  buildArtifact({
    title: 'top5-ai-2026-v2.pptx',
    type: TOOL_ARTIFACT_TYPES.PRESENTATION,
    content: '<!doctype html><html><body>preview of slide 1</body></html>',
    file: {
      file_id: '17f4cc67-6bb2-4e52-a18f-c0596d51e85a',
      filename: 'top5-ai-2026-v2.pptx',
      filepath: '/uploads/user-1/17f4cc67__top5-ai-2026-v2.pptx',
      source: FileSources.local,
      user: 'user-1',
    },
  });

describe('DownloadArtifact', () => {
  beforeEach(() => {
    downloadedContent = null;
    downloadedName = undefined;
    getFileDownload.mockReset();
    getFileDownload.mockResolvedValue({
      data: new OriginalBlob(['pptx-bytes']),
      headers: {},
    });
    global.Blob = function BlobDouble(parts: string[], options?: BlobPropertyBag) {
      downloadedContent = (parts ?? []).join('');
      return new OriginalBlob(parts, options);
    } as unknown as typeof Blob;
    global.URL.createObjectURL = jest.fn(
      () => 'blob:artifact',
    ) as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL = jest.fn();

    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function mockClick(this: HTMLAnchorElement) {
        downloadedName = this.download;
      });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    global.Blob = OriginalBlob;
  });

  /* The object URL is released, but not before the browser has had a chance to
   * start reading it — revoking on the line after `click()` aborts the save on
   * engines that read the blob asynchronously, which is why the shared
   * `triggerDownload` helper defers it. */
  it('saves the shown file and releases the object url once the save has started', () => {
    jest.useFakeTimers();
    try {
      renderDownload(buildArtifact({ title: 'report.md' }));

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:artifact');
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The name comes from the sandpack file key, not from the artifact, so every
   * markdown artifact lands in Downloads as `content.md` and every office one
   * as `index.html` — save two and the second overwrites the first. Recorded as
   * failing so that fixing it turns this into a plain assertion instead of
   * breaking a test that had pinned the defect as correct.
   */
  it.failing('saves under the name the panel shows', () => {
    renderDownload(buildArtifact({ title: 'report.md' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    expect(downloadedName).toBe('report.md');
  });

  it('downloads what the user edited rather than the original content', () => {
    renderDownload(buildArtifact());

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(downloadedContent).toBe('original content');

    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(downloadedContent).toBe('content the user edited');
  });

  it('saves the stored .pptx, not the HTML preview standing in for it', async () => {
    renderDownload(presentationArtifact());

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(getFileDownload).toHaveBeenCalledTimes(1));
    expect(getFileDownload).toHaveBeenCalledWith('user-1', '17f4cc67-6bb2-4e52-a18f-c0596d51e85a');
    await waitFor(() => expect(downloadedName).toBe('top5-ai-2026-v2.pptx'));
    /* The preview markup must not be what lands in Downloads — that is the
     * defect: an `index.html` page saved in place of the presentation. */
    expect(downloadedContent).toBeNull();
  });

  it('still saves the shown content for an artifact that has no stored file', async () => {
    renderDownload(buildArtifact({ title: 'notes.md', content: 'plain notes' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(getFileDownload).not.toHaveBeenCalled();
    expect(downloadedContent).toBe('plain notes');
  });

  /* An office file whose server-side HTML render did not run is downgraded to
   * the plain-text bucket and shown as extracted text. Naming that text after
   * the binary is the same "right name, wrong bytes" defect the control exists
   * to avoid — Word would report a corrupt document. */
  it('does not name extracted text after the binary it was extracted from', async () => {
    renderDownload(
      buildArtifact({
        title: 'contract.docx',
        type: TOOL_ARTIFACT_TYPES.PLAIN_TEXT,
        content: 'extracted contract text',
        file: {
          file_id: 'fid-1',
          filename: 'contract.docx',
          filepath: '/uploads/user-1/fid-1__contract.docx',
          source: FileSources.local,
          user: 'user-1',
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(getFileDownload).not.toHaveBeenCalled();
    expect(downloadedContent).toBe('extracted contract text');
    expect(downloadedName).not.toBe('contract.docx');
  });

  /* A shared conversation keeps `file_id` and `filepath` but strips `user` and
   * `source`, so the download route cannot serve it. Routing there anyway hit a
   * storage path the server does not serve and saved nothing at all. */
  it('falls back to the shown content when the stored file cannot be fetched', async () => {
    const shared = presentationArtifact();
    renderDownload({ ...shared, file: { ...shared.file, source: undefined, user: undefined } });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(getFileDownload).not.toHaveBeenCalled();
    expect(downloadedContent).toContain('preview of slide 1');
  });

  /* An office bucket can be reached by MIME alone, so a record may have no
   * usable name. Saving real .pptx bytes as `index.html` would be the mirror
   * image of the defect being fixed. */
  it('does not fetch the original when the record has no name to save it under', async () => {
    const anonymous = presentationArtifact();
    renderDownload({ ...anonymous, file: { ...anonymous.file, filename: undefined } });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(getFileDownload).not.toHaveBeenCalled();
    expect(downloadedName).toBe('index.html');
  });

  it('does not report success when the download failed', async () => {
    getFileDownload.mockRejectedValue(new Error('file expired'));
    renderDownload(presentationArtifact());

    const button = screen.getByRole('button', { name: 'com_ui_download_artifact' });
    fireEvent.click(button);

    await waitFor(() => expect(getFileDownload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-downloaded')).toBeNull();
  });

  it('reports success only after the stored file actually arrived', async () => {
    renderDownload(presentationArtifact());

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(screen.getByTestId('artifact-downloaded')).toBeInTheDocument());
  });

  /* A second click cancels the in-flight fetch and resolves from the cache with
   * an object URL already revoked, so the save silently produces nothing. */
  it('ignores a second click while the first download is in flight', async () => {
    let release: (value: unknown) => void = () => undefined;
    getFileDownload.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderDownload(presentationArtifact());

    const button = screen.getByRole('button', { name: 'com_ui_download_artifact' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    release({ data: new OriginalBlob(['pptx-bytes']), headers: {} });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(getFileDownload).toHaveBeenCalledTimes(1);
  });

  it('saves the stored original for a citation-opened file preview and never the edit buffer', async () => {
    /* 17.08 review: the FILE_PREVIEW pointer from a citation carries only
     * file_id+filename — no user, no source. The header download must fetch
     * the original AS THE CURRENT USER (the body already does), and the blob
     * branch must be unreachable: with a leftover edit buffer it used to save
     * the OLD edited code of another artifact under index.html. */
    fireEvent.click(
      renderDownload(
        buildArtifact({
          title: 'digital.pdf',
          type: TOOL_ARTIFACT_TYPES.FILE_PREVIEW,
          content: '',
          file: { file_id: 'fid-9', filename: 'digital.pdf' },
        }),
      ).getByLabelText(EDIT_LABEL),
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(getFileDownload).toHaveBeenCalled());
    expect(getFileDownload.mock.calls[0][0]).toBe('current-user');
    expect(getFileDownload.mock.calls[0][1]).toBe('fid-9');
    await waitFor(() => expect(downloadedName).toBe('digital.pdf'));
    expect(downloadedContent).not.toBe(EDITED_TEXT);
  });

  it('downloads nothing when there is no content at all', () => {
    renderDownload(buildArtifact({ content: '' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(clickSpy).not.toHaveBeenCalled();

    /* The same button on a filled artifact must download, so the assertion
     * above cannot pass merely because the button never worked. */
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
