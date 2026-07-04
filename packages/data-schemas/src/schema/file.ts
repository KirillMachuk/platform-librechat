import mongoose, { Schema } from 'mongoose';
import { FileContext, FileSources } from 'librechat-data-provider';
import type { IMongoFile } from '~/types';

const file: Schema<IMongoFile> = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    conversationId: {
      type: String,
      ref: 'Conversation',
      index: true,
    },
    messageId: {
      type: String,
      index: true,
    },
    project_id: {
      type: String,
      index: true,
    },
    file_id: {
      type: String,
      index: true,
      required: true,
    },
    temp_file_id: {
      type: String,
    },
    bytes: {
      type: Number,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    filepath: {
      type: String,
      required: true,
    },
    storageKey: {
      type: String,
    },
    storageRegion: {
      type: String,
    },
    object: {
      type: String,
      required: true,
      default: 'file',
    },
    embedded: {
      type: Boolean,
    },
    embeddingStatus: {
      /* Async RAG embedding lifecycle (RAG_ASYNC_EMBED). The upload step
       * persists the record with 'pending' and responds immediately; the
       * background embed worker claims it ('processing', leased via
       * embedNextAt) and commits 'ready' (together with embedded: true)
       * or 'failed' (with embedError). Absent on legacy records and on
       * synchronous uploads (flag off). */
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
    },
    embedNextAt: {
      /* Dual-purpose scheduler field: for 'pending' — earliest next
       * attempt (retry backoff); for 'processing' — lease expiry, so a
       * record orphaned by a worker crash becomes claimable again once
       * the lease passes. Single index with embeddingStatus serves both. */
      type: Date,
    },
    embedAttempts: {
      type: Number,
    },
    embedError: {
      /* Short machine-readable reason when embeddingStatus === 'failed'
       * ('busy', 'timeout', 'network', 'unsupported', 'max-retries').
       * Mirrors the previewError cap to keep stack traces out of the DB. */
      type: String,
      maxlength: 200,
    },
    embedEntityId: {
      /* Entity namespace the file was scheduled to embed under (agent_id
       * for agent knowledge, project_id for project sources, absent for
       * plain chat attachments). The /query side resolves the same
       * namespace, so the background /embed MUST reuse this value
       * verbatim — a mismatch makes retrieval silently return nothing. */
      type: String,
    },
    type: {
      type: String,
      required: true,
    },
    text: {
      type: String,
    },
    textFormat: {
      /* 'html' when the backend produced a sanitized HTML preview
       * (office-type CDN/mammoth output), 'text' for plain-text
       * extracts (RAG / pdf-parse / mammoth.extractRawText). Clients
       * gate office-bucket routing on textFormat === 'html' to
       * prevent injecting RAG-extracted plain text into the iframe
       * as HTML. See Codex P1 review on PR #12934. */
      type: String,
      enum: ['html', 'text'],
    },
    status: {
      /* Deferred-preview code-execution flow: the immediate persist
       * step writes the record with 'pending'; the background render
       * (HTML extraction) updates to 'ready' or 'failed'. Absent on
       * legacy records and on file kinds that never expect a preview. */
      type: String,
      enum: ['pending', 'ready', 'failed'],
      index: true,
    },
    previewError: {
      type: String,
      /* Bounded to short machine-readable reasons (`'timeout'`,
       * `'parser-error'`, `'orphaned'`, `'unexpected'`). Cap prevents a
       * future codepath from accidentally persisting a stack trace or
       * full error message — would bloat documents and ship a wall of
       * text into the UI tooltip. */
      maxlength: 200,
    },
    previewRevision: {
      /* Generation marker for the deferred-preview lifecycle. Stamped
       * by the immediate persist step on every emit (each new emit
       * gets a fresh UUID); the deferred preview render's `updateFile`
       * only commits when the marker still matches what it was when
       * extraction started. Without this, two turns reusing the same
       * `(filename, conversationId)` share a `file_id`, and an older
       * render finishing after a newer one would silently overwrite
       * the newer record with stale `text`/`status`. (Codex P1 review
       * on PR #12957.) */
      type: String,
    },
    previewText: {
      /* Preview-only sanitized office HTML, rendered at upload time for
       * office-bucket files (csv/tsv/docx/xlsx/xls/ods/pptx) that go down
       * the full-text `context` path. That path stores the model's plain
       * extracted text in `text` and discards the original upload, so the
       * preview route's on-demand office renderer (which needs the original
       * bytes) can never fire for them. `previewText` carries the HTML the
       * client injects into the office iframe; it is NEVER read by the
       * model (the model reads `text`). Set alongside `status: 'ready'`;
       * on render failure `status: 'failed'` + `previewError` are set and
       * this stays absent. Produced only via `bufferToOfficeHtml`'s
       * sanitize pipeline, so it satisfies the textFormat==='html' /
       * no-plain-text-fallback gate from PR #12934. */
      type: String,
    },
    context: {
      type: String,
    },
    usage: {
      type: Number,
      required: true,
      default: 0,
    },
    source: {
      type: String,
      default: FileSources.local,
    },
    model: {
      type: String,
    },
    width: Number,
    height: Number,
    metadata: {
      codeEnvRef: {
        type: new Schema(
          {
            kind: {
              type: String,
              enum: ['skill', 'agent', 'user'],
              required: true,
            },
            id: { type: String, required: true },
            storage_session_id: { type: String, required: true },
            file_id: { type: String, required: true },
            version: { type: Number },
          },
          { _id: false },
        ),
        default: undefined,
      },
    },
    expiresAt: {
      /* Short-lived upload TTL managed by MongoDB. This is separate from
       * retention-scoped `expiredAt`, which is swept by application code
       * after storage cleanup succeeds. */
      type: Date,
      expires: 3600, // 1 hour in seconds
    },
    tenantId: {
      type: String,
      index: true,
    },
    expiredAt: {
      /* Retention deadline for persisted files. The file sweep deletes the
       * backing storage first, then removes this metadata record. */
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

file.index({ expiredAt: 1 });
file.index({ createdAt: 1, updatedAt: 1 });
file.index({ embeddingStatus: 1, embedNextAt: 1 });
file.index(
  { filename: 1, conversationId: 1, context: 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { context: FileContext.execute_code } },
);

export default file;
