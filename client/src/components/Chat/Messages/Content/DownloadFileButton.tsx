import { useCallback } from 'react';
import { useToastContext, TooltipAnchor } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import { useFileDownload } from '~/data-provider';
import { Download } from '~/components/icons';
import { triggerDownload } from '~/utils';

/** The chat file card's hover action (owner 12.08-2, ChatGPT's pattern):
 *  the card itself opens the preview, this button saves the file. */
export default function DownloadFileButton({ file }: { file: Partial<TFile> }) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file.file_id ?? '', {
    direct: false,
  });

  const handleDownload = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const stream = await downloadFile();
        if (stream.data == null || stream.data === '') {
          showToast({ status: 'error', message: localize('com_ui_download_error') });
          return;
        }
        triggerDownload(stream.data as string, file.filename ?? 'file');
      } catch {
        showToast({ status: 'error', message: localize('com_ui_download_error') });
      }
    },
    [downloadFile, file.filename, localize, showToast],
  );

  return (
    <TooltipAnchor
      description={localize('com_ui_download')}
      render={
        <button
          type="button"
          aria-label={localize('com_ui_download')}
          onClick={handleDownload}
          className="flex size-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-active hover:text-text-primary focus-visible:outline-none"
        >
          <Download className="icon-sm" aria-hidden="true" />
        </button>
      }
    />
  );
}
