import { useCallback, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { useToastContext } from '@librechat/client';
import { EToolResources, mergeFileConfig, getEndpointFileConfig } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import { useGetFiles, useUploadFileMutation, useGetFileConfig } from '~/data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import { validateFiles } from '~/utils';
import { useLocalize } from '~/hooks';

/** Concurrent uploads: bounded so a large batch can't open hundreds of parallel
 * requests (browser stalls, doc-gateway/embed overload). */
const LIBRARY_UPLOAD_CONCURRENCY = 4;
/** Hard cap per selection so a stray "select 5000 files" can't be enqueued at all. */
const LIBRARY_UPLOAD_MAX_BATCH = 200;

interface PendingUpload {
  file_id: string;
  filename: string;
}

interface UploadItem {
  file_id: string;
  file: File;
  isImage: boolean;
}

/** Worker-pool: run `worker` over `items` at most `limit` at a time, preserving order. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Standalone (no chat message) upload into the user's file library, with batch
 * multi-select. Documents are sent with `tool_resource='context'` so the server
 * extracts their full text AND indexes them into pgvector as
 * `embeddingScope='library'` (see process.js context branch), making them
 * findable by `library_search` across chats. Images are uploaded without a
 * tool_resource — the context branch can't text-parse an image without OCR, so
 * forcing it would error; they land as plain native files, and we warn the user
 * they won't be library-searchable.
 *
 * Uploads are validated (size/MIME) up front, throttled, and their outcomes
 * aggregated into a single summary so a partial failure in a large batch is
 * reported honestly rather than as one overwritten toast.
 */
export function useLibraryUpload() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const { data: filesList = [] } = useGetFiles<TFile[]>();
  const { data: fileConfig = null } = useGetFileConfig({ select: (data) => mergeFileConfig(data) });
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFileMutation = useUploadFileMutation();

  const removePending = useCallback((file_id: string) => {
    setPendingUploads((prev) => prev.filter((p) => p.file_id !== file_id));
  }, []);

  const validateBatch = useCallback(
    (fileList: File[], toolResource: string | undefined, endpoint: string): boolean => {
      let ok = true;
      const endpointFileConfig = {
        ...getEndpointFileConfig({ endpoint, fileConfig }),
        // Chat's default fileLimit (10) is for keeping context small; a library
        // dump legitimately uploads many, so validate size/MIME against a much
        // higher batch cap instead.
        fileLimit: LIBRARY_UPLOAD_MAX_BATCH,
      };
      validateFiles({
        files: new Map(),
        fileList,
        setError: (error: string) => {
          ok = false;
          showToast({ message: error, status: 'error' });
        },
        fileConfig,
        endpointFileConfig,
        toolResource,
      });
      return ok;
    },
    [fileConfig, showToast],
  );

  const processFiles = useCallback(
    async (all: File[]) => {
      if (all.length === 0) {
        return;
      }
      if (all.length > LIBRARY_UPLOAD_MAX_BATCH) {
        showToast({
          message: localize('com_ui_library_upload_too_many', {
            0: String(LIBRARY_UPLOAD_MAX_BATCH),
          }),
          status: 'warning',
        });
        return;
      }

      const endpoint = conversation?.endpoint ?? 'default';
      const images = all.filter((f) => f.type.startsWith('image/'));
      const docs = all.filter((f) => !f.type.startsWith('image/'));

      // Validate each group against its own MIME set (context vs native). A bad
      // file rejects the whole selection with a concrete error, before any upload.
      if (docs.length > 0 && !validateBatch(docs, EToolResources.context, endpoint)) {
        return;
      }
      if (images.length > 0 && !validateBatch(images, undefined, endpoint)) {
        return;
      }

      const items: UploadItem[] = all.map((file) => ({
        file_id: v4(),
        file,
        isImage: file.type.startsWith('image/'),
      }));
      setPendingUploads((prev) => [
        ...items.map((i) => ({ file_id: i.file_id, filename: i.file.name })),
        ...prev,
      ]);

      const outcomes = await runWithConcurrency(items, LIBRARY_UPLOAD_CONCURRENCY, async (item) => {
        const formData = new FormData();
        formData.append('endpoint', endpoint);
        formData.append('file', item.file, encodeURIComponent(item.file.name));
        formData.append('file_id', item.file_id);
        formData.append('message_file', 'true');
        if (!item.isImage) {
          formData.append('tool_resource', EToolResources.context);
        }
        try {
          await uploadFileMutation.mutateAsync(formData);
          return { ok: true };
        } catch {
          return { ok: false };
        } finally {
          removePending(item.file_id);
        }
      });

      const failed = outcomes.filter((o) => !o.ok).length;
      const total = outcomes.length;
      if (failed === total) {
        showToast({ message: localize('com_error_files_upload'), status: 'error' });
      } else if (failed > 0) {
        showToast({
          message: localize('com_ui_library_uploaded_partial', {
            0: String(total - failed),
            1: String(total),
          }),
          status: 'warning',
        });
      }
      // Honest, separate notice: images uploaded but not searchable.
      if (images.length > 0) {
        showToast({
          message: localize('com_ui_library_images_not_indexed', { 0: String(images.length) }),
          status: 'info',
        });
      }
      /* The user re-uploading a document they already have is usually intentional (a new
       * version), so we never block it — but silently growing a second identical row reads as
       * "nothing happened". Name the duplicates so the outcome is legible. */
      const existingNames = new Set(filesList.map((f) => f.filename));
      const duplicates = all.filter((f) => existingNames.has(f.name)).map((f) => f.name);
      if (duplicates.length > 0 && failed < total) {
        const shown = duplicates.slice(0, 3).join(', ');
        showToast({
          message: localize('com_ui_library_duplicate_names', {
            0: String(duplicates.length),
            1: duplicates.length > 3 ? `${shown}, …` : shown,
          }),
          status: 'info',
        });
      }
    },
    [
      conversation?.endpoint,
      filesList,
      localize,
      removePending,
      showToast,
      uploadFileMutation,
      validateBatch,
    ],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      e.target.value = '';
      if (!selected?.length) {
        return;
      }
      await processFiles(Array.from(selected));
    },
    [processFiles],
  );

  /* Counter, not boolean: dragenter/dragleave fire for every child the cursor crosses, and a
   * boolean flickers off while still inside the dialog. */
  const dragDepthRef = useRef(0);
  const [isDragActive, setIsDragActive] = useState(false);

  const dropHandlers = useMemo(
    () => ({
      onDragEnter: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) {
          return;
        }
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDragActive(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) {
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) {
          return;
        }
        e.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setIsDragActive(false);
        }
      },
      onDrop: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) {
          return;
        }
        /* Both are load-bearing: preventDefault stops the browser from navigating to the file,
         * stopPropagation keeps the chat's global dropzone (attach-to-message) from also
         * claiming a drop that was aimed at the library dialog. */
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = 0;
        setIsDragActive(false);
        void processFiles(Array.from(e.dataTransfer.files));
      },
    }),
    [processFiles],
  );

  const visiblePending = useMemo(() => {
    if (pendingUploads.length === 0) {
      return pendingUploads;
    }
    const knownIds = new Set(filesList.map((f) => f.file_id));
    return pendingUploads.filter((p) => !knownIds.has(p.file_id));
  }, [pendingUploads, filesList]);

  const isUploading = visiblePending.length > 0;
  const uploadStatusLabel = useMemo(() => {
    if (visiblePending.length === 0) {
      return '';
    }
    if (visiblePending.length === 1) {
      return localize('com_ui_uploading_file', { 0: visiblePending[0].filename });
    }
    return localize('com_ui_uploading_files_count', { 0: String(visiblePending.length) });
  }, [localize, visiblePending]);

  return {
    fileInputRef,
    handleFileUpload,
    isUploading,
    uploadStatusLabel,
    dropHandlers,
    isDragActive,
  };
}
