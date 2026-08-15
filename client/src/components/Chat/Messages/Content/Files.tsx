import { useMemo, memo } from 'react';
import type { TFile, TMessage } from 'librechat-data-provider';
import FileContainer from '~/components/Chat/Input/Files/FileContainer';
import useOpenFilePreview from '~/hooks/Artifacts/useOpenFilePreview';
import DownloadFileButton from './DownloadFileButton';
import Image from './Image';

const Files = ({
  message,
  nonImageOnly = false,
}: {
  message?: TMessage;
  nonImageOnly?: boolean;
}) => {
  const openFilePreview = useOpenFilePreview();
  const imageFiles = useMemo(() => {
    if (nonImageOnly) {
      return [];
    }
    return message?.files?.filter((file) => file.type?.startsWith('image/')) || [];
  }, [message?.files, nonImageOnly]);

  const otherFiles = useMemo(() => {
    return message?.files?.filter((file) => !file.type?.startsWith('image/')) || [];
  }, [message?.files]);

  return (
    <>
      {otherFiles.length > 0 &&
        otherFiles.map((file) => (
          <FileContainer
            key={file.file_id}
            file={file as TFile}
            /* 14.08-3: любой файл, кроме картинок, открывается в ПРАВОЙ панели;
               модалка по центру остаётся только у фото (Image ниже). */
            onClick={() => openFilePreview(file as TFile)}
            trailing={<DownloadFileButton file={file as TFile} />}
          />
        ))}
      {imageFiles.length > 0 &&
        imageFiles.map((file) => (
          <Image
            key={file.file_id}
            imagePath={file.preview ?? file.filepath ?? ''}
            height={file.height ?? 1920}
            width={file.width ?? 1080}
            altText={file.filename ?? 'Uploaded Image'}
          />
        ))}
    </>
  );
};

export default memo(Files);
