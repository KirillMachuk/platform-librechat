import type { GoogleWorkspaceFile, GoogleWorkspaceKind, GoogleWorkspaceMimeType } from '~/common';

const GOOGLE_WORKSPACE_HOST = 'docs.google.com';
const GOOGLE_DRIVE_HOST = 'drive.google.com';
const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]+$/;

const MIME_BY_KIND: Record<GoogleWorkspaceKind, GoogleWorkspaceMimeType> = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  drive_file: 'application/octet-stream',
};

const PATH_BY_KIND: Record<
  Exclude<GoogleWorkspaceKind, 'drive_file'>,
  'document' | 'spreadsheets' | 'presentation'
> = {
  document: 'document',
  spreadsheet: 'spreadsheets',
  presentation: 'presentation',
};

const KIND_BY_PATH = {
  document: 'document',
  spreadsheets: 'spreadsheet',
  presentation: 'presentation',
} as const satisfies Record<string, Exclude<GoogleWorkspaceKind, 'drive_file'>>;

export type ParsedGoogleWorkspaceUrl = Omit<GoogleWorkspaceFile, 'name' | 'provider'>;

export const GOOGLE_FILE_LOCALIZATION_KEYS = {
  document: {
    fallbackName: 'com_ui_google_document',
    openAction: 'com_ui_open_in_google_docs',
  },
  spreadsheet: {
    fallbackName: 'com_ui_google_spreadsheet',
    openAction: 'com_ui_open_in_google_sheets',
  },
  presentation: {
    fallbackName: 'com_ui_google_presentation',
    openAction: 'com_ui_open_in_google_slides',
  },
  drive_file: {
    fallbackName: 'com_ui_google_drive_file',
    openAction: 'com_ui_open_in_google_drive',
  },
} as const satisfies Record<GoogleWorkspaceKind, { fallbackName: string; openAction: string }>;

/**
 * Accept only canonical Google Workspace and Drive file URLs and discard every
 * caller-controlled suffix, query parameter, and fragment. This is the trust
 * boundary before a remote URL may enter the preview iframe.
 */
export function parseGoogleWorkspaceUrl(rawUrl: string): ParsedGoogleWorkspaceUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    (url.hostname !== GOOGLE_WORKSPACE_HOST && url.hostname !== GOOGLE_DRIVE_HOST) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null;
  }

  if (url.hostname === GOOGLE_DRIVE_HOST) {
    const match = /^\/file\/d\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
    if (!match || !GOOGLE_FILE_ID.test(match[1])) {
      return null;
    }

    const fileId = match[1];
    return {
      fileId,
      kind: 'drive_file',
      mimeType: MIME_BY_KIND.drive_file,
      viewUrl: `https://${GOOGLE_DRIVE_HOST}/file/d/${fileId}/view`,
    };
  }

  const match = /^\/(document|spreadsheets|presentation)\/d\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
  if (!match) {
    return null;
  }

  const kind = KIND_BY_PATH[match[1] as keyof typeof KIND_BY_PATH];
  const fileId = match[2];
  if (!GOOGLE_FILE_ID.test(fileId)) {
    return null;
  }

  return {
    fileId,
    kind,
    mimeType: MIME_BY_KIND[kind],
    viewUrl: `https://${GOOGLE_WORKSPACE_HOST}/${PATH_BY_KIND[kind]}/d/${fileId}/edit`,
  };
}

export function getGoogleWorkspaceEmbedUrl(
  file: ParsedGoogleWorkspaceUrl,
  isMobile: boolean,
): string {
  if (file.kind === 'drive_file') {
    return `https://${GOOGLE_DRIVE_HOST}/file/d/${file.fileId}/preview`;
  }

  if (file.kind === 'spreadsheet' && isMobile) {
    return `https://${GOOGLE_WORKSPACE_HOST}/spreadsheets/d/${file.fileId}/htmlview?widget=true&headers=true&chrome=false`;
  }

  return file.viewUrl;
}

/** Re-check a stored artifact at render time before using its remote URL. */
export function validateGoogleWorkspaceFile(
  file: GoogleWorkspaceFile | undefined,
): ParsedGoogleWorkspaceUrl | null {
  if (!file || file.provider !== 'google_drive') {
    return null;
  }
  const parsed = parseGoogleWorkspaceUrl(file.viewUrl);
  if (
    !parsed ||
    parsed.fileId !== file.fileId ||
    parsed.kind !== file.kind ||
    parsed.mimeType !== file.mimeType
  ) {
    return null;
  }
  return parsed;
}
