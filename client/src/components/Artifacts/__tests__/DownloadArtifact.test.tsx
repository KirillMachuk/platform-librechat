import React from 'react';
import { dataService, FileSources } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Artifact } from '~/common';
import { EditorProvider, useCodeState } from '~/Providers/EditorContext';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import DownloadArtifact from '../DownloadArtifact';

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
 * record what the component actually put into the downloaded file. */
const OriginalBlob = global.Blob;
let downloadedContent = '';
let downloadedName: string | undefined;
let clickSpy: jest.SpyInstance;

const renderDownload = (artifact: Artifact) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EditorProvider>
        <EditBuffer />
        <DownloadArtifact artifact={artifact} />
      </EditorProvider>
    </QueryClientProvider>,
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
    downloadedContent = '';
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

  it('saves the shown file and releases the object url', () => {
    renderDownload(buildArtifact({ title: 'report.md' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:artifact');
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
    expect(downloadedContent).toBe('');
  });

  it('still saves the shown content for an artifact that has no stored file', async () => {
    renderDownload(buildArtifact({ title: 'notes.md', content: 'plain notes' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(getFileDownload).not.toHaveBeenCalled();
    expect(downloadedContent).toBe('plain notes');
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
