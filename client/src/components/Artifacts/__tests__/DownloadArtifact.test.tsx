import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
    <EditorProvider>
      <EditBuffer />
      <DownloadArtifact artifact={artifact} />
    </EditorProvider>,
  );

describe('DownloadArtifact', () => {
  beforeEach(() => {
    downloadedContent = '';
    downloadedName = undefined;
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

  it('downloads the shown file under its own name', () => {
    renderDownload(buildArtifact({ title: 'report.md' }));

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe('content.md');
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:artifact');
  });

  it('downloads what the user edited rather than the original content', () => {
    renderDownload(buildArtifact());

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(downloadedContent).toBe('original content');

    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_download_artifact' }));
    expect(downloadedContent).toBe('content the user edited');
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
