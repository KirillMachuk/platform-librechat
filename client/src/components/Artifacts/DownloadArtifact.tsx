import React, { useState } from 'react';
import { Button } from '@librechat/client';
import type { Artifact } from '~/common';
import { useAttachmentLink } from '~/components/Chat/Messages/Content/Parts/LogLink';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import { Download, CircleCheckBig } from '~/components/icons';
import { isPreviewOnlyArtifact } from '~/utils/artifacts';
import { useCodeState } from '~/Providers/EditorContext';
import { useLocalize } from '~/hooks';

const DownloadArtifact = ({ artifact }: { artifact: Artifact }) => {
  const localize = useLocalize();
  const { currentCode } = useCodeState();
  const [isDownloaded, setIsDownloaded] = useState(false);
  const { fileKey } = useArtifactProps({ artifact });
  const sourceFile = artifact.file;
  const fileName = sourceFile?.filename ?? fileKey;
  /**
   * A preview-only artifact shows server-rendered HTML standing in for a
   * binary the panel cannot reproduce, so saving what is on screen hands the
   * user an `index.html` page instead of their .pptx. Fetch the stored
   * original for those. Every other bucket IS its content — and the editor
   * may be holding unsaved changes — so it keeps saving what is shown.
   */
  const savesTheOriginal = isPreviewOnlyArtifact(artifact.type) && sourceFile?.file_id != null;
  const { handleDownload: downloadOriginal } = useAttachmentLink({
    href: sourceFile?.filepath ?? '',
    filename: fileName,
    file_id: sourceFile?.file_id,
    user: sourceFile?.user,
    source: sourceFile?.source,
  });

  const confirmDownloaded = () => {
    setIsDownloaded(true);
    setTimeout(() => setIsDownloaded(false), 3000);
  };

  const handleDownload = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (savesTheOriginal) {
      await downloadOriginal(event);
      confirmDownloaded();
      return;
    }
    try {
      const content = currentCode ?? artifact.content ?? '';
      if (!content) {
        return;
      }
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
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
      onClick={handleDownload}
      aria-label={localize('com_ui_download_artifact')}
    >
      {isDownloaded ? (
        <CircleCheckBig size={16} aria-hidden="true" />
      ) : (
        <Download size={16} aria-hidden="true" />
      )}
    </Button>
  );
};

export default DownloadArtifact;
