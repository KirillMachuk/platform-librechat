import { useCallback, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { useToastContext } from '@librechat/client';
import {
  EModelEndpoint,
  EToolResources,
  mergeFileConfig,
  getEndpointFileConfig,
} from 'librechat-data-provider';
import type { TFile, FileConfig } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type { FileError } from '~/common';
import { useGetFiles, useUploadFileMutation, useGetFileConfig } from '~/data-provider';
import { validateFiles } from '~/utils';
import { useLocalize } from '~/hooks';

/**
 * Endpoint stamped on the upload FormData. The library is a STANDALONE store, not the active
 * chat: the `/files` route sends anything that isn't an assistants endpoint through
 * `processAgentFileUpload`, which owns the context + library-indexing branch — so a fixed
 * `agents` value is correct here and, crucially, needs no chat context. Reading it from
 * `useChatContext()` (as this hook first did) threw whenever the Files modal was opened from the
 * global sidebar / account menu, which live OUTSIDE `ChatContext.Provider` — the upload silently
 * died before any request left the browser.
 */
const LIBRARY_UPLOAD_ENDPOINT = EModelEndpoint.agents;

/** Concurrent uploads: bounded so a large batch can't open hundreds of parallel
 * requests (browser stalls, doc-gateway/embed overload). */
const LIBRARY_UPLOAD_CONCURRENCY = 4;
/** Hard cap per selection so a stray "select 5000 files" can't be enqueued at all. The batch
 * actually offered is the smaller of this and what the server will accept — see `maxBatch`. */
const LIBRARY_UPLOAD_MAX_BATCH = 200;

/** Aggregate size allowed for one library selection, per file offered.
 *
 * The endpoint's own `totalSizeLimit` is a chat budget — 200 MB on this deployment — and it
 * silently contradicted the batch: offering 200 files while capping the selection at 200 MB
 * demands an average file under 1 MB, when the client's own scanned contracts average 6.7 MB.
 * A realistic archive import was rejected in full, before a single upload left the browser.
 * Per-file size and the server's rate limit remain the real ceilings; this only keeps a stray
 * selection from queueing an unbounded pile. */
const LIBRARY_UPLOAD_AVG_FILE_BYTES = 10 * 1024 * 1024;

/** Whether an upload was turned away by the server's rate limiter rather than failing. */
function isRateLimited(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 429;
}

/**
 * The batch this instance may really upload: the UI must never offer more than the server takes.
 * Measured on the stand before this was derived — the hook advertised 200 while the server was
 * configured for 50 per hour, so a 100-file import ended as "uploaded 50 of 100" with no reason
 * shown, no limit named, and no hint that the remainder needed an hour's wait.
 */
function resolveMaxBatch(uploadLimits?: FileConfig['uploadLimits']): number {
  const serverMax = uploadLimits?.userMax;
  if (typeof serverMax !== 'number' || serverMax <= 0) {
    return LIBRARY_UPLOAD_MAX_BATCH;
  }
  return Math.min(LIBRARY_UPLOAD_MAX_BATCH, serverMax);
}

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
  const { data: filesList = [] } = useGetFiles<TFile[]>();
  const { data: fileConfig = null } = useGetFileConfig({ select: (data) => mergeFileConfig(data) });
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  const uploadFileMutation = useUploadFileMutation();
  const maxBatch = resolveMaxBatch(fileConfig?.uploadLimits);

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
        fileLimit: maxBatch,
        totalSizeLimit: maxBatch * LIBRARY_UPLOAD_AVG_FILE_BYTES,
      };
      validateFiles({
        files: new Map(),
        fileList,
        setError: (error: FileError) => {
          ok = false;
          // Раньше сюда попадал сам ключ перевода и человек читал
          // «com_error_files_empty» вместо объяснения.
          const message =
            typeof error === 'string'
              ? localize(error as TranslationKeys) || error
              : localize(error.key as TranslationKeys, error.values) || error.key;
          showToast({ message, status: 'error' });
        },
        fileConfig,
        endpointFileConfig,
        toolResource,
      });
      return ok;
    },
    [fileConfig, maxBatch, showToast, localize],
  );

  const processFiles = useCallback(
    async (all: File[]) => {
      if (all.length === 0) {
        return;
      }
      if (all.length > maxBatch) {
        showToast({
          message: localize('com_ui_library_upload_too_many', { 0: String(maxBatch) }),
          status: 'warning',
        });
        return;
      }

      const endpoint = LIBRARY_UPLOAD_ENDPOINT;
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
          return { ok: true, rateLimited: false };
        } catch (error) {
          return { ok: false, rateLimited: isRateLimited(error) };
        } finally {
          removePending(item.file_id);
        }
      });

      const failed = outcomes.filter((o) => !o.ok).length;
      const total = outcomes.length;
      /* A rejection for hitting the server's rate limit is not a failure of the document, and
       * folding it into "the rest failed, please retry them" told the user to do the one thing
       * that makes it worse: every rejected request counts against the window too. Name the
       * limit instead, so the wait is understood rather than fought. */
      const rateLimited = outcomes.filter((o) => o.rateLimited).length;
      if (rateLimited > 0) {
        const limits = fileConfig?.uploadLimits;
        showToast({
          /* Without the server's numbers the honest thing is still to say "later", never
           * "retry them" — that advice is what makes the wait longer. */
          message: limits
            ? localize('com_ui_library_upload_rate_limited', {
                0: String(total - failed),
                1: String(total),
                2: String(limits.userMax),
                3: String(limits.userWindowInMinutes),
              })
            : localize('com_ui_library_upload_rate_limited_unknown', {
                0: String(total - failed),
                1: String(total),
              }),
          status: 'warning',
        });
      } else if (failed === total) {
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
      fileConfig,
      filesList,
      localize,
      maxBatch,
      removePending,
      showToast,
      uploadFileMutation,
      validateBatch,
    ],
  );

  /**
   * Opens the OS file picker via an input created OUTSIDE the React tree (on document.body).
   *
   * Why not a rendered `<input ref>` inside the modal: opening the native picker blurs the
   * window, and both dialog libraries here (MyFilesModal = Radix, the sidebar Files panel =
   * Headless UI) close on focus-loss. That unmounts an in-tree input before its `change` fires —
   * the file goes nowhere, no request leaves the browser, no error (the production bug: "выбираю
   * файл, Открыть, ничего"). A body-level input is immune: it survives the dialog closing, so
   * `change` always lands. Cleanup covers both outcomes — pick (`change`) and cancel (the input
   * is removed on the next window focus, since `cancel` isn't emitted by every browser).
   */
  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';

    let settled = false;
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
    };
    const onWindowFocus = () => {
      // Fires when the OS picker closes (pick OR cancel). Defer so a real `change` runs first.
      window.setTimeout(cleanup, 300);
    };

    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      if (files.length > 0) {
        void processFiles(files);
      }
    });
    window.addEventListener('focus', onWindowFocus);
    document.body.appendChild(input);
    input.click();
  }, [processFiles]);

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
    openFilePicker,
    isUploading,
    uploadStatusLabel,
    dropHandlers,
    isDragActive,
  };
}
