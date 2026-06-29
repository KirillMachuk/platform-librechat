/**
 * Bug ② fix: Deep Research must search ONLY the files attached to the current
 * chat — never the whole project's RAG corpus. The host controller fetches the
 * conversation's embedded files (`getConvoFiles(conversationId)` ∩ `embedded`)
 * and passes them here; this maps them to `createFileSearchTool` inputs with the
 * correct per-file `entity_id` (the namespace the file was embedded under), so
 * RAG retrieval resolves the right vectors. Crucially, project files are NOT
 * merged in — the researcher only sees chat-attached documents.
 */

/** A subset of a file DB record (from `getFiles({ file_id: {$in}, embedded: true })`). */
export interface EmbeddedFileRecord {
  file_id?: string;
  filename?: string;
  /** RAG namespace the file was embedded under (per-file), if any. */
  embedEntityId?: string;
  /** Project namespace fallback (mirrors `primeFiles`). */
  project_id?: string;
}

/** A `createFileSearchTool` `files[]` entry. */
export interface FileSearchInput {
  file_id: string;
  filename: string;
  entity_id?: string;
}

/** Maps chat-attached embedded files to file_search inputs (chat-only, no project merge). */
export function selectChatFileSearchInputs(embeddedFiles: EmbeddedFileRecord[]): FileSearchInput[] {
  const inputs: FileSearchInput[] = [];
  for (const file of embeddedFiles) {
    if (!file.file_id) {
      continue;
    }
    inputs.push({
      file_id: file.file_id,
      filename: file.filename ?? file.file_id,
      entity_id: file.embedEntityId ?? file.project_id,
    });
  }
  return inputs;
}
