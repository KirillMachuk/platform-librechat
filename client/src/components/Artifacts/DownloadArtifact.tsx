import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import type { Artifact } from '~/common';
import {
  canDownloadStoredFile,
  useAttachmentLink,
} from '~/components/Chat/Messages/Content/Parts/LogLink';
import { isFilePreviewArtifact, isPreviewOnlyArtifact } from '~/utils/artifacts';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import { Download, CircleCheckBig } from '~/components/icons';
import { useCodeState } from '~/Providers/EditorContext';
import { triggerDownload } from '~/utils';
import { useLocalize } from '~/hooks';

const DownloadArtifact = ({ artifact }: { artifact: Artifact }) => {
  const localize = useLocalize();
  const { currentCode } = useCodeState();
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { fileKey } = useArtifactProps({ artifact });
  const sourceFile = artifact.file;
  /**
   * A preview-only artifact shows server-rendered HTML standing in for a binary
   * the panel cannot reproduce, so saving what is on screen hands the user an
   * `index.html` page instead of their .pptx. Fetch the stored original for
   * those. Every other bucket IS its content — and the editor may be holding
   * unsaved changes — so it keeps saving what is shown.
   *
   * The gate has to ask the same question the download handler answers.
   * Checking only `file_id` sent shared conversations (which keep `file_id` but
   * lose `user` and `source`) down a branch that cannot serve them. A record
   * with no usable name is excluded too: an office bucket can be reached by
   * MIME alone, and saving real .pptx bytes under the sandpack key would be the
   * mirror image of the defect this control exists to fix.
   */
  const savesTheOriginal =
    (isPreviewOnlyArtifact(artifact.type) || isFilePreviewArtifact(artifact.type)) &&
    canDownloadStoredFile(sourceFile ?? {}) &&
    !!sourceFile?.filename;
  /**
   * The name must describe the bytes, not the artifact. Naming the rendered
   * text after the binary produces a `report.docx` full of plain text — the
   * same "right name, wrong bytes" defect this control exists to avoid, since
   * an office file whose server-side HTML render failed is downgraded to the
   * plain-text bucket and renders as extracted text.
   */
  const fileName = savesTheOriginal ? (sourceFile?.filename as string) : fileKey;
  const { handleDownload: downloadOriginal } = useAttachmentLink({
    href: sourceFile?.filepath ?? '',
    filename: fileName,
    file_id: sourceFile?.file_id,
    user: sourceFile?.user,
    source: sourceFile?.source,
  });

  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const confirmDownloaded = () => {
    setIsDownloaded(true);
    confirmTimer.current = setTimeout(() => setIsDownloaded(false), 3000);
  };

  const handleDownload = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (savesTheOriginal) {
      setIsDownloading(true);
      try {
        if (await downloadOriginal(event)) {
          confirmDownloaded();
        }
      } finally {
        setIsDownloading(false);
      }
      return;
    }
    try {
      const content = currentCode ?? artifact.content ?? '';
      if (!content) {
        return;
      }
      const blob = new Blob([content], { type: 'text/plain' });
      triggerDownload(window.URL.createObjectURL(blob), fileName);
      confirmDownloaded();
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-9 w-9"
      /* A second click while the first fetch is in flight cancels it and
       * resolves from the cache with an object URL already revoked, so the
       * save silently produces nothing. One download at a time. */
      disabled={isDownloading}
      onClick={handleDownload}
      aria-label={localize('com_ui_download_artifact')}
    >
      {isDownloaded ? (
        <CircleCheckBig size={16} aria-hidden="true" data-testid="artifact-downloaded" />
      ) : (
        <Download size={16} aria-hidden="true" />
      )}
    </Button>
  );
};

export default DownloadArtifact;
