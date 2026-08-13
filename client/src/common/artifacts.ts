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
 */
export interface ArtifactSourceFile {
  file_id?: string;
  filename?: string;
  filepath?: string;
  source?: string;
  user?: string;
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
