/**
 * The bare i18next singleton, not `~/locales/i18n`: this module sits in the
 * `~/utils` barrel that half the app imports, and pulling the init module in
 * here would drag i18n bootstrapping into every one of those graphs. Our init
 * configures this same instance, so `.language` reads the same value.
 */
import i18n from 'i18next';
import {
  megabyte,
  QueryKeys,
  inferMimeType,
  EToolResources,
  documentParserMimeTypes,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import type { TFile, EndpointFileConfig, FileConfig } from 'librechat-data-provider';
import type { QueryClient } from '@tanstack/react-query';
import type { ExtendedFile, FileError } from '~/common';
import { resolveLocale } from './messages';

/* The colour-plate icon map (`getFileType`/`fileTypes`, hand-drawn *Paths
 * artwork) is gone — every file glyph now comes from ONE Tabler map:
 * `Chat/Input/Files/typeMeta.tsx` (owner 14.08-2: replace ALL old icons). */

/**
 * Format a date string for reading, in the language the user chose in the app —
 * not the browser's. An employee on a Russian interface in an English-locale
 * browser must still see "14 авг. 2026 г.". `i18n.language` is the app's own
 * source of truth and is always a normalized tag, kept in sync by LanguageSync.
 *
 * Note that English output changed with this: the old hand-rolled version always
 * produced "14 Aug 2026", whereas `en` through Intl is "Aug 14, 2026". That is
 * what an English-locale reader expects, so it is the intended result and not a
 * regression — but it is a visible change, so it is written down here.
 *
 * @example
 * formatDate('2026-08-14T09:05:00Z')       // en: 'Aug 14, 2026' · ru: '14 авг. 2026 г.'
 * formatDate('2026-08-14T09:05:00Z', true) // en: '8/14/26'      · ru: '14.08.26'
 */
type DateLike = string | number | Date | null | undefined;

/** Intl throws RangeError on an invalid date, so anything unparseable renders as nothing. */
function toValidDate(value: DateLike): Date | null {
  if (value == null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const LONG_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const SHORT_DATE: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  year: '2-digit',
};

/**
 * Building an `Intl.DateTimeFormat` costs ~28µs — it loads locale data — while
 * formatting with a built one costs ~0.6µs. These helpers render one cell per
 * row (files, archived chats, shared links), so a 200-row table paid ~5.6ms per
 * render for formatters it threw away. There are two shapes and one language at
 * a time, so the cache stays at a handful of entries.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(short: boolean): Intl.DateTimeFormat {
  /* Keyed on the raw language: resolveLocale() validates through Intl too, so
     doing it per call would put back part of the cost this cache removes. */
  const key = `${i18n.language ?? ''}|${short ? 's' : 'l'}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      resolveLocale(i18n.language),
      short ? SHORT_DATE : LONG_DATE,
    );
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatDate(value?: DateLike, isSmallScreen = false): string {
  const date = toValidDate(value);
  if (!date) {
    return '';
  }
  return dateFormatter(isSmallScreen).format(date);
}

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Date plus time, for rows where the hour matters (versions, keys, refills).
 *
 * Deliberately not delegating to getMessageTimestamp: that also builds a
 * RelativeTimeFormat and walks the duration to produce a "3 days ago" string
 * this caller throws away — 41µs per call against 0.8µs here, and these render
 * once per row in the agent-version and prompt-version lists.
 */
export function formatTimestamp(value?: DateLike): string {
  const date = toValidDate(value);
  if (!date) {
    return '';
  }
  const key = i18n.language ?? '';
  let formatter = timestampFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(resolveLocale(i18n.language), DATE_TIME);
    timestampFormatters.set(key, formatter);
  }
  return formatter.format(date);
}

/**
 * Adds a file to the query cache
 */
export function addFileToCache(queryClient: QueryClient, newfile: TFile) {
  const currentFiles = queryClient.getQueryData<TFile[]>([QueryKeys.files]);

  if (!currentFiles) {
    console.warn('No current files found in cache, skipped updating file query cache');
    return;
  }

  const fileIndex = currentFiles.findIndex((file) => file.file_id === newfile.file_id);

  if (fileIndex > -1) {
    console.warn('File already exists in cache, skipped updating file query cache');
    return;
  }

  queryClient.setQueryData<TFile[]>(
    [QueryKeys.files],
    [
      {
        ...newfile,
      },
      ...currentFiles,
    ],
  );
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) {
    return 0;
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
}

const { checkType } = defaultFileConfig;

export const validateFiles = ({
  files,
  fileList,
  setError,
  endpointFileConfig,
  toolResource,
  fileConfig,
}: {
  fileList: File[];
  files: Map<string, ExtendedFile>;
  setError: (error: FileError) => void;
  endpointFileConfig: EndpointFileConfig;
  toolResource?: string;
  fileConfig: FileConfig | null;
}) => {
  const { fileLimit, fileSizeLimit, totalSizeLimit, supportedMimeTypes, disabled } =
    endpointFileConfig;
  /** Block all uploads if the endpoint is explicitly disabled */
  if (disabled === true) {
    setError('com_ui_attach_error_disabled');
    return false;
  }
  const existingFiles = Array.from(files.values());
  const incomingTotalSize = fileList.reduce((total, file) => total + file.size, 0);
  if (incomingTotalSize === 0) {
    setError('com_error_files_empty');
    return false;
  }
  const currentTotalSize = existingFiles.reduce((total, file) => total + file.size, 0);

  if (fileLimit && fileList.length + files.size > fileLimit) {
    setError({ key: 'com_ui_attach_error_file_limit', values: { count: fileLimit } });
    return false;
  }

  for (let i = 0; i < fileList.length; i++) {
    let originalFile = fileList[i];
    const fileType = inferMimeType(originalFile.name, originalFile.type);

    // Check if the file type is still empty after the extension check
    if (!fileType) {
      setError({ key: 'com_ui_attach_error_type_unknown', values: { name: originalFile.name } });
      return false;
    }

    // Replace empty type with inferred type
    if (originalFile.type !== fileType) {
      const newFile = new File([originalFile], originalFile.name, { type: fileType });
      originalFile = newFile;
      fileList[i] = newFile;
    }

    let mimeTypesToCheck = supportedMimeTypes;
    if (toolResource === EToolResources.context) {
      /* Mirror the server's context route exactly (process.js): a document is accepted when it
       * matches text, configured OCR, STT — or the BUILT-IN document parser, which the server
       * consults regardless of the OCR config (`shouldUseDocumentParser`). Without that last
       * set, narrowing `fileConfig.ocr.supportedMimeTypes` to scans (image+pdf, as our yaml
       * does) made the client reject docx/xlsx that the server parses fine via doc-gateway. */
      mimeTypesToCheck = [
        ...(fileConfig?.text?.supportedMimeTypes || []),
        ...(fileConfig?.ocr?.supportedMimeTypes || []),
        ...(fileConfig?.stt?.supportedMimeTypes || []),
        ...documentParserMimeTypes,
      ];
    }

    if (!checkType(originalFile.type, mimeTypesToCheck)) {
      setError({
        key: 'com_ui_attach_error_type_unsupported',
        values: { type: originalFile.type },
      });
      return false;
    }

    if (fileSizeLimit && originalFile.size >= fileSizeLimit) {
      setError({ key: 'com_ui_attach_error_size', values: { limit: fileSizeLimit / megabyte } });
      return false;
    }
  }

  if (totalSizeLimit && currentTotalSize + incomingTotalSize > totalSizeLimit) {
    setError({ key: 'com_ui_attach_error_total', values: { limit: totalSizeLimit / megabyte } });
    return false;
  }

  const combinedFilesInfo = [
    ...existingFiles.map(
      (file) =>
        `${file.file?.name ?? file.filename}-${file.size}-${file.type?.split('/')[0] ?? 'file'}`,
    ),
    ...fileList.map(
      (file: File | undefined) =>
        `${file?.name}-${file?.size}-${file?.type.split('/')[0] ?? 'file'}`,
    ),
  ];

  const uniqueFilesSet = new Set(combinedFilesInfo);

  if (uniqueFilesSet.size !== combinedFilesInfo.length) {
    setError('com_error_files_dupe');
    return false;
  }

  return true;
};

export function sortPagesByRelevance(
  pages: number[],
  pageRelevance: Record<number, number>,
): number[] {
  if (!pageRelevance || Object.keys(pageRelevance).length === 0) {
    return pages;
  }
  return [...pages].sort((a, b) => (pageRelevance[b] || 0) - (pageRelevance[a] || 0));
}
