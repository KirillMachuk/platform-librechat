import type { TFile } from 'librechat-data-provider';

export interface CodeBlock {
  id: string;
  language: string;
  content: string;
}

/**
 * Identity of the stored file an artifact was produced from, when there is
 * one. Model-authored artifacts (`:::artifact` blocks) have no file and omit
 * it. The office preview buckets render server-generated HTML in the panel
 * while the real deliverable is this binary, so the panel's download control
 * needs the file rather than the preview it happens to be showing.
 *
 * Every field is optional because a shared conversation strips `user` and
 * `source` on the way out, but the shape is a projection of `TFile` so
 * `source` keeps its enum and a wrong value cannot typecheck.
 */
export type ArtifactSourceFile = Partial<
  Pick<TFile, 'file_id' | 'filename' | 'filepath' | 'source' | 'user'>
>;

export type GoogleWorkspaceKind = 'document' | 'spreadsheet' | 'presentation' | 'drive_file';

export type GoogleWorkspaceMimeType =
  | 'application/vnd.google-apps.document'
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.presentation'
  | 'application/octet-stream';

export interface GoogleWorkspaceFile {
  provider: 'google_drive';
  fileId: string;
  name: string;
  mimeType: GoogleWorkspaceMimeType;
  viewUrl: string;
  kind: GoogleWorkspaceKind;
}

export interface Artifact {
  id: string;
  lastUpdateTime: number;
  index?: number;
  messageId?: string;
  identifier?: string;
  language?: string;
  content?: string;
  title?: string;
  type?: string;
  file?: ArtifactSourceFile;
  /** Google Workspace preview only: a validated pointer to the remote file. */
  googleWorkspace?: GoogleWorkspaceFile;
  /** FILE_PREVIEW only: display meta the chips already computed (mime, size,
   *  search relevance, matched pages). The panel body renders it in the meta
   *  strip; every field optional so no other artifact type is touched. */
  preview?: {
    fileType?: string;
    bytes?: number;
    relevance?: number;
    pages?: number[];
    pageRelevance?: Record<number, number>;
  };
}

export type ArtifactFiles =
  | {
      'App.tsx': string;
      'index.tsx': string;
      '/components/ui/MermaidDiagram.tsx': string;
    }
  | Partial<{
      [x: string]: string | undefined;
    }>;
