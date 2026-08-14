import type { LucideIcon } from '~/components/icons';
import {
  Code,
  FileArchive,
  FileText,
  FileTypePdf,
  Film,
  Globe,
  ImageIcon,
  Music,
  TableIcon,
  File,
} from '~/components/icons';

export interface FileTypeMeta {
  /** The TYPE is said by the drawing alone — the colour is the text's own
   *  (owner 12.08-2, референс Perplexity: «иконки в цвет шрифта»). */
  Icon: LucideIcon;
  labelKey:
    | 'com_ui_file_type_document'
    | 'com_ui_file_type_spreadsheet'
    | 'com_ui_file_type_pdf'
    | 'com_ui_file_type_image'
    | 'com_ui_file_type_code'
    | 'com_ui_file_type_web'
    | 'com_ui_file_type_audio'
    | 'com_ui_file_type_video'
    | 'com_ui_file_type_archive'
    | 'com_ui_file_type_file';
}

const document: FileTypeMeta = { Icon: FileText, labelKey: 'com_ui_file_type_document' };
const spreadsheet: FileTypeMeta = { Icon: TableIcon, labelKey: 'com_ui_file_type_spreadsheet' };
const pdf: FileTypeMeta = { Icon: FileTypePdf, labelKey: 'com_ui_file_type_pdf' };
const image: FileTypeMeta = { Icon: ImageIcon, labelKey: 'com_ui_file_type_image' };
const code: FileTypeMeta = { Icon: Code, labelKey: 'com_ui_file_type_code' };
const web: FileTypeMeta = { Icon: Globe, labelKey: 'com_ui_file_type_web' };
const audio: FileTypeMeta = { Icon: Music, labelKey: 'com_ui_file_type_audio' };
const video: FileTypeMeta = { Icon: Film, labelKey: 'com_ui_file_type_video' };
const archive: FileTypeMeta = { Icon: FileArchive, labelKey: 'com_ui_file_type_archive' };
const plain: FileTypeMeta = { Icon: File, labelKey: 'com_ui_file_type_file' };

/* Office/document formats FIRST and by their exact registered names: the
 * 12.08-3 bug was a loose /xml/ "code" pattern swallowing
 * application/vnd.openxmlformats-officedocument.wordprocessingml.document —
 * every docx drew as code. Office mimes all contain "xml" or "sheet"
 * substrings, so the specific families must win before any generic pattern,
 * and the generic patterns must match whole subtype tokens, not substrings. */
const DOCUMENT_TYPES =
  /(wordprocessingml|msword|opendocument\.text|application\/rtf|text\/rtf|epub\+zip)/;
const SPREADSHEET_TYPES = /(spreadsheetml|ms-excel|opendocument\.spreadsheet|csv|apple\.numbers)/;
const PRESENTATION_TYPES = /(presentationml|ms-powerpoint|opendocument\.presentation)/;
/** Generic code/data subtypes as WHOLE tokens after the slash (json, xml,
 *  yaml…), or well-known x- language prefixes. `\b` alone is not enough:
 *  "openxmlformats" contains the token "xml" mid-word. */
const CODE_TYPES =
  /(^|\/)(x-)?(javascript|typescript|python|java|c|c\+\+|csrc|sh|shellscript|json|xml|yaml|sql|ruby|go|rust|php|toml)(\+json|\+xml)?$/;
const ARCHIVE_TYPES = /(^|\/)(zip|x-zip-compressed|x-tar|x-7z-compressed|x-rar-compressed|gzip)$/;

const EXTENSION_KINDS: Record<string, FileTypeMeta> = {
  doc: document,
  docx: document,
  odt: document,
  rtf: document,
  epub: document,
  txt: document,
  md: document,
  pages: document,
  xls: spreadsheet,
  xlsx: spreadsheet,
  csv: spreadsheet,
  tsv: spreadsheet,
  ods: spreadsheet,
  numbers: spreadsheet,
  ppt: document,
  pptx: document,
  odp: document,
  key: document,
  pdf: pdf,
  png: image,
  jpg: image,
  jpeg: image,
  gif: image,
  webp: image,
  heic: image,
  heif: image,
  svg: image,
  js: code,
  jsx: code,
  ts: code,
  tsx: code,
  py: code,
  java: code,
  rb: code,
  go: code,
  rs: code,
  php: code,
  sh: code,
  json: code,
  xml: code,
  yaml: code,
  yml: code,
  sql: code,
  toml: code,
  html: web,
  htm: web,
  zip: archive,
  tar: archive,
  gz: archive,
  rar: archive,
  '7z': archive,
  mp3: audio,
  wav: audio,
  ogg: audio,
  m4a: audio,
  flac: audio,
  mp4: video,
  mov: video,
  avi: video,
  mkv: video,
  webm: video,
};

/** The mime → drawing decision for the file chips (composer and chat). Kept
 *  NEXT to the chips rather than in utils/files.ts: getFileType there still
 *  owns upload validation; this map owns only which glyph a chip draws. */
export function fileTypeMeta(mime = ''): FileTypeMeta {
  const normalized = mime.toLowerCase();
  /* Generated attachments arrive with a bare extension («pptx»), not a mime —
     the 12.08-3 unification means BOTH spellings must land on one glyph. */
  if (!normalized.includes('/') && EXTENSION_KINDS[normalized] != null) {
    return EXTENSION_KINDS[normalized];
  }
  if (normalized.startsWith('image/')) {
    return image;
  }
  if (normalized.includes('pdf')) {
    return pdf;
  }
  if (DOCUMENT_TYPES.test(normalized)) {
    return document;
  }
  if (SPREADSHEET_TYPES.test(normalized)) {
    return spreadsheet;
  }
  if (PRESENTATION_TYPES.test(normalized)) {
    return document;
  }
  if (normalized.includes('html')) {
    return web;
  }
  if (ARCHIVE_TYPES.test(normalized)) {
    return archive;
  }
  if (CODE_TYPES.test(normalized)) {
    return code;
  }
  if (normalized.startsWith('audio/')) {
    return audio;
  }
  if (normalized.startsWith('video/')) {
    return video;
  }
  if (normalized.startsWith('text/')) {
    return document;
  }
  return plain;
}

const EXTENSION_PATTERN = /\.([a-z0-9]{1,8})$/i;

/** «DOCX 18 КБ» — the composer/chat card's second line (owner 12.08-3):
 *  the extension people recognize plus the weight; images keep their square
 *  preview and never reach this. Returns null parts when unknown so the
 *  caller can fall back to the localized type name. */
export function fileBadge(
  filename?: string | null,
  bytes?: number | null,
): { extension: string | null; size: string | null } {
  const match = filename != null ? EXTENSION_PATTERN.exec(filename) : null;
  const extension = match ? match[1].toUpperCase() : null;
  if (bytes == null || Number.isNaN(bytes) || bytes <= 0) {
    return { extension, size: null };
  }
  if (bytes < 1024) {
    return { extension, size: `${bytes} B` };
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return { extension, size: `${kb < 100 ? kb.toFixed(1) : Math.round(kb)} KB` };
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return { extension, size: `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB` };
  }
  const gb = mb / 1024;
  return { extension, size: `${gb.toFixed(1)} GB` };
}
