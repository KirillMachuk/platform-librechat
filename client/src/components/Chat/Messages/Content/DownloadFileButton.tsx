import { useCallback } from 'react';
import { useToastContext } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import CardDownloadButton from '~/components/Chat/Input/Files/CardDownloadButton';
import { useLocalize, useAuthContext } from '~/hooks';
import { useFileDownload } from '~/data-provider';
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

  return <CardDownloadButton onClick={handleDownload} name={file.filename ?? undefined} />;
}
