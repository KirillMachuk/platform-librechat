import debounce from 'lodash/debounce';
import { FileSources, EToolResources, removeNullishValues } from 'librechat-data-provider';
import { useCallback, useState, useEffect } from 'react';
import type * as t from 'librechat-data-provider';
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import type { ExtendedFile, GenericSetter } from '~/common';
import useSetFilesToDelete from './useSetFilesToDelete';
import { deletePreview } from '~/utils';

type FileMapSetter = GenericSetter<Map<string, ExtendedFile>>;

const useFileDeletion = ({
  mutateAsync,
  agent_id,
  assistant_id,
  tool_resource,
}: {
  mutateAsync: UseMutateAsyncFunction<t.DeleteFilesResponse, unknown, t.DeleteFilesBody, unknown>;
  agent_id?: string;
  assistant_id?: string;
  tool_resource?: EToolResources;
}) => {
  const [_batch, setFileDeleteBatch] = useState<t.BatchFile[]>([]);
  const setFilesToDelete = useSetFilesToDelete();

  const executeBatchDelete = useCallback(
    ({
      filesToDelete,
      agent_id,
      assistant_id,
      tool_resource,
    }: {
      filesToDelete: t.BatchFile[];
      agent_id?: string;
      assistant_id?: string;
      tool_resource?: EToolResources;
    }) => {
      const payload = removeNullishValues({
        agent_id,
        assistant_id,
        tool_resource,
      });
      console.log('Deleting files:', filesToDelete, payload);
      mutateAsync({ files: filesToDelete, ...payload });
      setFileDeleteBatch([]);
    },
    [mutateAsync],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedDelete = useCallback(debounce(executeBatchDelete, 1000), []);

  useEffect(() => {
    // Cleanup function for debouncedDelete when component unmounts or before re-render
    return () => debouncedDelete.cancel();
  }, [debouncedDelete]);

  const deleteFile = useCallback(
    ({ file: _file, setFiles }: { file: ExtendedFile | t.TFile; setFiles?: FileMapSetter }) => {
      const {
        file_id,
        temp_file_id = '',
        filepath = '',
        source = FileSources.local,
        embedded,
        attached = false,
      } = _file as t.TFile & { attached?: boolean };

      const progress = _file['progress'] ?? 1;
      const stillUploading = progress < 1;

      // Always remove from the UI first — even mid-upload — so the X button
      // works while a slow file (e.g. a scanned PDF, whose OCR+embed keeps the
      // upload request open for a minute or more) is still processing.
      // `updateFileById` no-ops on a missing entry, so a late upload onSuccess
      // cannot resurrect a file the user just removed. The in-flight request is
      // also aborted by the caller (FileRow#handleDelete -> abortUpload).
      if (setFiles) {
        setFiles((currentFiles) => {
          const updatedFiles = new Map(currentFiles);
          updatedFiles.delete(file_id);
          updatedFiles.delete(temp_file_id);
          const files = Object.fromEntries(updatedFiles);
          setFilesToDelete(files);
          return updatedFiles;
        });
      }

      deletePreview(file_id);
      if (temp_file_id) {
        deletePreview(temp_file_id);
      }

      // A still-uploading file isn't persisted server-side yet, and an
      // explicitly `attached` file is owned elsewhere — in both cases skip the
      // server-side batch delete.
      if (stillUploading || attached) {
        return;
      }

      const file: t.BatchFile = {
        file_id,
        embedded,
        filepath,
        source,
      };

      setFileDeleteBatch((prevBatch) => {
        const newBatch = [...prevBatch, file];
        debouncedDelete({
          filesToDelete: newBatch,
          agent_id,
          assistant_id,
          tool_resource,
        });
        return newBatch;
      });
    },
    [debouncedDelete, setFilesToDelete, agent_id, assistant_id, tool_resource],
  );

  const deleteFiles = useCallback(
    ({ files, setFiles }: { files: ExtendedFile[] | t.TFile[]; setFiles?: FileMapSetter }) => {
      const batchFiles: t.BatchFile[] = [];
      for (const _file of files) {
        const {
          file_id,
          embedded,
          temp_file_id,
          filepath = '',
          source = FileSources.local,
        } = _file;

        batchFiles.push({
          source,
          file_id,
          filepath,
          temp_file_id,
          embedded: embedded ?? false,
        });

        deletePreview(file_id);
        if (temp_file_id) {
          deletePreview(temp_file_id);
        }
      }

      if (setFiles) {
        setFiles((currentFiles) => {
          const updatedFiles = new Map(currentFiles);
          batchFiles.forEach((file) => {
            updatedFiles.delete(file.file_id);
            if (file.temp_file_id) {
              updatedFiles.delete(file.temp_file_id);
            }
          });
          const filesToUpdate = Object.fromEntries(updatedFiles);
          setFilesToDelete(filesToUpdate);
          return updatedFiles;
        });
      }

      setFileDeleteBatch((prevBatch) => {
        const newBatch = [...prevBatch, ...batchFiles];
        debouncedDelete({
          filesToDelete: newBatch,
          agent_id,
          assistant_id,
        });
        return newBatch;
      });
    },
    [debouncedDelete, setFilesToDelete, agent_id, assistant_id],
  );

  return { deleteFile, deleteFiles };
};

export default useFileDeletion;
