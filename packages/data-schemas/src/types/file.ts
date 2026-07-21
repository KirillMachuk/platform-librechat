import { Document, Types } from 'mongoose';
import type { CodeEnvRef, TDocMetadata } from 'librechat-data-provider';

export interface IMongoFile extends Omit<Document, 'model'> {
  user: Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  project_id?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  text?: string;
  /**
   * Extracted text kept for on-demand reading (`open_document`) rather than for the
   * prompt. Set on documents routed to RAG, where `text` is deliberately absent so the
   * attachment path never inlines them. Read `text ?? fullText` when you want "the
   * document's text, whatever route it took".
   */
  fullText?: string;
  /**
   * Format of the `text` field — `'html'` when the backend produced
   * a sanitized full-document HTML preview (e.g. office types via
   * `bufferToOfficeHtml`), `'text'` for plain-text extracts (e.g.
   * RAG mammoth/pdf-parse output), `undefined` for legacy records
   * that pre-date the field. Clients MUST treat `undefined` as
   * `'text'` and refuse to inject the value into HTML contexts —
   * otherwise plain document text containing `<script>` tags would
   * become executable markup. See Codex P1 review on PR #12934.
   */
  textFormat?: 'html' | 'text';
  /**
   * Lifecycle of the inline preview rendered from `text`. Tracks the
   * deferred-preview code-execution flow (PR #12951 follow-up): the
   * immediate persist step saves the file blob and emits the attachment
   * record with `status: 'pending'`; a background render runs HTML
   * extraction and updates the record to `'ready'` (with `text` +
   * `textFormat`) or `'failed'` (with `previewError`). Decouples the
   * agent's final response from CPU-heavy office-format rendering.
   *
   * Absent for legacy records and for files that never expect a preview
   * (RAG uploads, images, plain-text artifacts). Clients MUST treat
   * `undefined` as `'ready'` so prior-version records render normally.
   */
  status?: 'pending' | 'ready' | 'failed';
  /**
   * Short machine-readable reason when `status === 'failed'` —
   * `'timeout'`, `'parser-error'`, `'oversized'`, `'orphaned'`. UI hint
   * for tooltip text; not user-facing prose. Absent otherwise.
   */
  previewError?: string;
  /**
   * Generation marker for the deferred-preview lifecycle. The
   * immediate persist step stamps a fresh UUID on every emit; the
   * deferred render's update only commits when the marker still
   * matches. Guards against an older render overwriting a newer
   * record on cross-turn filename reuse. Absent for legacy records
   * and for files that never expect a preview.
   */
  previewRevision?: string;
  /**
   * Preview-only sanitized office HTML rendered at upload time for
   * office-bucket files uploaded via the full-text `context` path (which
   * stores plain extracted text in `text` and discards the original, so
   * on-demand office rendering can't run later). Never read by the model.
   * Present only when `status === 'ready'` for such records.
   */
  previewText?: string;
  filename: string;
  filepath: string;
  storageKey?: string;
  storageRegion?: string;
  object: 'file';
  embedded?: boolean;
  /**
   * Async RAG embedding lifecycle (RAG_ASYNC_EMBED). 'pending' — queued
   * for the background embed worker; 'processing' — claimed (lease via
   * embedNextAt); 'ready' — embedded (set together with embedded: true);
   * 'failed' — gave up (see embedError). Absent on legacy records and on
   * synchronous uploads; clients MUST treat undefined as ready.
   */
  embeddingStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  /** Scheduler: next retry time (pending) or lease expiry (processing). */
  embedNextAt?: Date;
  embedAttempts?: number;
  /** Short machine-readable reason when embeddingStatus === 'failed'. */
  embedError?: string;
  /**
   * Entity namespace (agent_id / project_id) the background /embed must
   * use verbatim — retrieval queries the same namespace.
   */
  embedEntityId?: string;
  /**
   * Why the file is embedded. 'chat' (or absent) = participates in the chat
   * retrieval floor / file_search tool. 'library' = a full-text context file
   * indexed only for cross-chat library_search; excluded from the floor to
   * avoid double injection on top of its inlined full text.
   */
  embeddingScope?: 'chat' | 'library';
  /**
   * Privacy marker written at upload time: `true` = the file belongs to a temporary/incognito
   * chat and must never be cross-chat findable. Deliberately separate from `expiredAt` — under
   * `retentionMode: ALL` every file carries a retention deadline, so an expiry date stopped
   * implying "temporary". Absent on legacy records = unknown (scope treats it fail-closed).
   */
  temporary?: boolean;
  /**
   * Document-level facts from the document's header, extracted at indexing time (doc-gateway
   * `/metadata`): what it is, its parties, its own date/place, its identifiers. Powers attribute
   * filters and the document card in library_search. Absent when extraction failed or was
   * skipped — treat as unknown, never as "no parties".
   */
  docMetadata?: TDocMetadata;
  type: string;
  context?: string;
  usage: number;
  source: string;
  model?: string;
  width?: number;
  height?: number;
  metadata?: {
    /**
     * Code-environment cache pointer for files re-uploadable to
     * codeapi (chat attachments, agent tool resources, code-output
     * files). Carries the resource kind + identity so codeapi can
     * derive the sessionKey explicitly.
     */
    codeEnvRef?: CodeEnvRef;
  };
  expiresAt?: Date;
  expiredAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}
