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

const CODE_TYPES =
  /(javascript|typescript|x-python|x-java|x-c|x-sh|json|xml|yaml|x-yaml|sql|x-ruby|x-go|x-rust|x-php)/;
const SPREADSHEET_TYPES = /(csv|excel|spreadsheet|sheet|numbers)/;
const DOCUMENT_TYPES = /(msword|wordprocessingml|opendocument\.text|rtf|epub)/;
const ARCHIVE_TYPES = /(zip|x-tar|x-7z|x-rar|gzip)/;

/** The mime → drawing decision for the file chips (composer and chat). Kept
 *  NEXT to the chips rather than in utils/files.ts: getFileType there still
 *  owns upload validation and the localized old titles; this map owns only
 *  which Tabler glyph a chip draws. */
export function fileTypeMeta(mime = ''): FileTypeMeta {
  if (mime.startsWith('image/')) {
    return image;
  }
  if (mime.includes('pdf')) {
    return pdf;
  }
  if (SPREADSHEET_TYPES.test(mime)) {
    return spreadsheet;
  }
  if (mime.includes('html')) {
    return web;
  }
  if (CODE_TYPES.test(mime)) {
    return code;
  }
  if (DOCUMENT_TYPES.test(mime)) {
    return document;
  }
  if (ARCHIVE_TYPES.test(mime)) {
    return archive;
  }
  if (mime.startsWith('audio/')) {
    return audio;
  }
  if (mime.startsWith('video/')) {
    return video;
  }
  if (mime.startsWith('text/')) {
    return document;
  }
  return plain;
}
