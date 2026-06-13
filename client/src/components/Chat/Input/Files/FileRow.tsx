import { useEffect } from 'react';
import { useToastContext } from '@librechat/client';
import { EToolResources, dataService } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useDeleteFilesMutation } from '~/data-provider';
import { logger, getCachedPreview } from '~/utils';
import { useFileDeletion } from '~/hooks/Files';
import FileContainer from './FileContainer';
import { useLocalize } from '~/hooks';
import Image from './Image';

export default function FileRow({
  files: _files,
  setFiles,
  abortUpload,
  setFilesLoading,
  assistant_id,
  agent_id,
  tool_resource,
  fileFilter,
  isRTL = false,
  Wrapper,
}: {
  files: Map<string, ExtendedFile> | undefined;
  abortUpload?: () => void;
  setFiles: React.Dispatch<React.SetStateAction<Map<string, ExtendedFile>>>;
  setFilesLoading?: React.Dispatch<React.SetStateAction<boolean>>;
  fileFilter?: (file: ExtendedFile) => boolean;
  assistant_id?: string;
  agent_id?: string;
  tool_resource?: EToolResources;
  isRTL?: boolean;
  Wrapper?: React.FC<{ children: React.ReactNode }>;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const files = Array.from(_files?.values() ?? []).filter((file) =>
    fileFilter ? fileFilter(file) : true,
  );

  /* RAG_ASYNC_EMBED: file_ids of attachments still indexing into the vector
   * store. Stable string key so the poll effect re-subscribes only when the
   * set actually changes (not on every render). Empty — and thus inert — when
   * the async flag is off and no record carries `embeddingStatus`. */
  const indexingKey = files
    .filter((file) => file.embeddingStatus === 'pending' || file.embeddingStatus === 'processing')
    .map((file) => file.file_id)
    .filter(Boolean)
    .sort()
    .join(',');

  const { mutateAsync } = useDeleteFilesMutation({
    onMutate: async () =>
      logger.log(
        'agents',
        'Deleting files: agent_id, assistant_id, tool_resource',
        agent_id,
        assistant_id,
        tool_resource,
      ),
    onSuccess: () => {
      console.log('Files deleted');
    },
    onError: (error) => {
      console.log('Error deleting files:', error);
    },
  });

  const { deleteFile } = useFileDeletion({ mutateAsync, agent_id, assistant_id, tool_resource });

  useEffect(() => {
    if (!setFilesLoading) return;
    if (files.length === 0) {
      setFilesLoading(false);
      return;
    }

    if (files.some((file) => file.progress < 1)) {
      setFilesLoading(true);
      return;
    }

    // RAG_ASYNC_EMBED: keep send disabled while an attachment is still indexing
    // — the document is uploaded but not yet searchable, so a question now would
    // miss it. Mirrors the upload-in-progress block (ChatGPT-style gate).
    if (indexingKey) {
      setFilesLoading(true);
      return;
    }

    if (files.every((file) => file.progress === 1)) {
      setFilesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, indexingKey]);

  /* Poll the embedding status of indexing attachments and fold the result back
   * into the file map, so the send-button block above releases on its own once
   * the vector store can see the document. Runs only while something is
   * indexing; tears down when the set empties. */
  useEffect(() => {
    if (!indexingKey) {
      return;
    }
    let cancelled = false;
    const sync = async () => {
      try {
        const allFiles = await dataService.getFiles();
        if (cancelled) {
          return;
        }
        const freshById = new Map(allFiles.map((file) => [file.file_id, file]));
        setFiles((current) => {
          let changed = false;
          const next = new Map(current);
          for (const [key, file] of next) {
            const fresh = file.file_id ? freshById.get(file.file_id) : undefined;
            if (fresh && fresh.embeddingStatus !== file.embeddingStatus) {
              next.set(key, {
                ...file,
                embeddingStatus: fresh.embeddingStatus,
                embedded: fresh.embedded ?? file.embedded,
              });
              changed = true;
            }
          }
          return changed ? next : current;
        });
      } catch {
        // Transient (network/auth refresh); the next tick retries.
      }
    };
    const intervalId = setInterval(sync, 5000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [indexingKey, setFiles]);

  if (files.length === 0) {
    return null;
  }

  const renderFiles = () => {
    const rowStyle = isRTL
      ? {
          display: 'flex',
          flexDirection: 'row-reverse',
          flexWrap: 'wrap',
          gap: '4px',
          width: '100%',
          maxWidth: '100%',
        }
      : {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          width: '100%',
          maxWidth: '100%',
        };

    return (
      <div style={rowStyle as React.CSSProperties}>
        {files
          .reduce(
            (acc, current) => {
              if (!acc.map.has(current.file_id)) {
                acc.map.set(current.file_id, true);
                acc.uniqueFiles.push(current);
              }
              return acc;
            },
            { map: new Map(), uniqueFiles: [] as ExtendedFile[] },
          )
          .uniqueFiles.map((file: ExtendedFile, index: number) => {
            const handleDelete = () => {
              if (abortUpload && file.progress < 1) {
                abortUpload();
              }
              if (file.progress >= 1 && !file.attached) {
                showToast({
                  message: localize('com_ui_deleting_file'),
                  status: 'info',
                });
              }
              deleteFile({ file, setFiles });
            };
            const isImage = file.type?.startsWith('image') ?? false;

            return (
              <div
                key={index}
                style={{
                  flexBasis: '70px',
                  flexGrow: 0,
                  flexShrink: 0,
                }}
              >
                {isImage ? (
                  <Image
                    url={getCachedPreview(file.file_id) ?? file.preview ?? file.filepath}
                    onDelete={handleDelete}
                    progress={file.progress}
                    source={file.source}
                  />
                ) : (
                  <FileContainer file={file} onDelete={handleDelete} />
                )}
              </div>
            );
          })}
      </div>
    );
  };

  if (Wrapper) {
    return <Wrapper>{renderFiles()}</Wrapper>;
  }

  return renderFiles();
}
