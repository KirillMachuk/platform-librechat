import type { GoogleWorkspaceFile, GoogleWorkspaceKind, GoogleWorkspaceMimeType } from '~/common';

const GOOGLE_WORKSPACE_HOST = 'docs.google.com';
const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]+$/;

const MIME_BY_KIND: Record<GoogleWorkspaceKind, GoogleWorkspaceMimeType> = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
};

const PATH_BY_KIND: Record<GoogleWorkspaceKind, 'document' | 'spreadsheets'> = {
  document: 'document',
  spreadsheet: 'spreadsheets',
};

export type ParsedGoogleWorkspaceUrl = Omit<GoogleWorkspaceFile, 'name' | 'provider'>;

/**
 * Accept only canonical Google Docs and Sheets file URLs and discard every
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
    url.hostname !== GOOGLE_WORKSPACE_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null;
  }

  const match = /^\/(document|spreadsheets)\/d\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
  if (!match) {
    return null;
  }

  const kind: GoogleWorkspaceKind = match[1] === 'document' ? 'document' : 'spreadsheet';
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
