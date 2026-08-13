import React from 'react';
import { useToastContext } from '@librechat/client';
import { FileSources } from 'librechat-data-provider';
import { useCodeOutputDownload, useFileDownload } from '~/data-provider';
import { isHttpDownloadTarget, triggerDownload } from '~/utils';

interface LogLinkProps {
  href: string;
  filename: string;
  file_id?: string;
  user?: string;
  source?: string;
  children: React.ReactNode;
}

interface AttachmentLinkOptions {
  href: string;
  filename: string;
  file_id?: string;
  user?: string;
  source?: string;
}

/**
 * Determines if a file is stored locally (not an external API URL).
 * Files with these sources are stored on the LibreChat server and should
 * use the /api/files/download endpoint instead of direct URL access.
 */
const isLocallyStoredSource = (source?: string): boolean => {
  if (!source) {
    return false;
  }
  return [
    FileSources.local,
    FileSources.firebase,
    FileSources.s3,
    FileSources.cloudfront,
    FileSources.azure_blob,
  ].includes(source as FileSources);
};

/**
 * Whether the download route can actually serve this record's bytes. Callers
 * that must decide BEFORE clicking — the artifacts panel picks between the
 * stored original and the content it is rendering — have to ask the same
 * question the handler answers, or they route work to a branch that cannot
 * succeed: a shared conversation strips `user` and `source` while keeping
 * `file_id`, and the leftover `filepath` is a storage path the server does
 * not serve.
 */
export const canDownloadStoredFile = ({
  file_id,
  user,
  source,
}: Pick<AttachmentLinkOptions, 'file_id' | 'user' | 'source'>): boolean =>
  isLocallyStoredSource(source) && !!file_id && !!user;

export const useAttachmentLink = ({
  href,
  filename,
  file_id,
  user,
  source,
}: AttachmentLinkOptions) => {
  const { showToast } = useToastContext();

  const useLocalDownload = canDownloadStoredFile({ file_id, user, source });
  const { refetch: downloadFromApi } = useFileDownload(user, file_id, { source });
  const { refetch: downloadFromUrl } = useCodeOutputDownload(href);

  /** Resolves to whether bytes actually reached the browser. Callers that show
   * a "saved" confirmation must gate it on this: every failure path below is
   * handled in place and would otherwise read as success. */
  const handleDownload = async (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ): Promise<boolean> => {
    event.preventDefault();
    try {
      if (!useLocalDownload && isHttpDownloadTarget(href)) {
        triggerDownload(href, filename);
        return true;
      }

      const stream = useLocalDownload ? await downloadFromApi() : await downloadFromUrl();
      if (stream.data == null || stream.data === '') {
        console.error('Error downloading file: No data found');
        showToast({
          status: 'error',
          message: 'Error downloading file',
        });
        return false;
      }
      triggerDownload(stream.data, filename);
      return true;
    } catch (error) {
      console.error('Error downloading file:', error);
      showToast({
        status: 'error',
        message: 'Error downloading file',
      });
      return false;
    }
  };

  return { handleDownload };
};

const LogLink: React.FC<LogLinkProps> = ({ href, filename, file_id, user, source, children }) => {
  const { handleDownload } = useAttachmentLink({ href, filename, file_id, user, source });
  return (
    <a
      href={href}
      onClick={handleDownload}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-accent underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  );
};

export default LogLink;
