import type { CodeEnvRef } from '../codeEnvRef';
import { EToolResources } from './assistants';

export enum FileSources {
  local = 'local',
  firebase = 'firebase',
  azure = 'azure',
  azure_blob = 'azure_blob',
  openai = 'openai',
  s3 = 's3',
  cloudfront = 'cloudfront',
  vectordb = 'vectordb',
  execute_code = 'execute_code',
  mistral_ocr = 'mistral_ocr',
  azure_mistral_ocr = 'azure_mistral_ocr',
  vertexai_mistral_ocr = 'vertexai_mistral_ocr',
  text = 'text',
  document_parser = 'document_parser',
}

export const checkOpenAIStorage = (source: string) =>
  source === FileSources.openai || source === FileSources.azure;

export enum FileContext {
  avatar = 'avatar',
  unknown = 'unknown',
  agents = 'agents',
  project = 'project',
  assistants = 'assistants',
  execute_code = 'execute_code',
  image_generation = 'image_generation',
  assistants_output = 'assistants_output',
  message_attachment = 'message_attachment',
  skill_file = 'skill_file',
  filename = 'filename',
  updatedAt = 'updatedAt',
  source = 'source',
  filterSource = 'filterSource',
  context = 'context',
  bytes = 'bytes',
}

export type EndpointFileConfig = {
  disabled?: boolean;
  fileLimit?: number;
  fileSizeLimit?: number;
  totalSizeLimit?: number;
  supportedMimeTypes?: RegExp[];
};

export type FileConfig = {
  endpoints: {
    [key: string]: EndpointFileConfig;
  };
  skills?: {
    fileSizeLimit?: number;
  };
  fileTokenLimit?: number;
  serverFileSizeLimit?: number;
  avatarSizeLimit?: number;
  clientImageResize?: {
    enabled?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  };
  ocr?: {
    supportedMimeTypes?: RegExp[];
  };
  text?: {
    supportedMimeTypes?: RegExp[];
  };
  stt?: {
    supportedMimeTypes?: RegExp[];
  };
  checkType?: (fileType: string, supportedTypes: RegExp[]) => boolean;
};

export type FileConfigInput = {
  endpoints?: {
    [key: string]: EndpointFileConfig;
  };
  skills?: {
    fileSizeLimit?: number;
  };
  serverFileSizeLimit?: number;
  avatarSizeLimit?: number;
  clientImageResize?: {
    enabled?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  };
  ocr?: {
    supportedMimeTypes?: string[];
  };
  text?: {
    supportedMimeTypes?: string[];
  };
  stt?: {
    supportedMimeTypes?: string[];
  };
  checkType?: (fileType: string, supportedTypes: RegExp[]) => boolean;
};

/**
 * Keys that identify the DOCUMENT itself — its number, its articles. Contacts and tax ids the
 * extractor also finds are deliberately not kept: they identify parties, not the document, they
 * are personal data in a card shown to the model, and hybrid search already finds them in the
 * text (measured: the exact-row needle scores 1.00).
 */
export type TDocIdentifier = {
  type: 'DOC_NO' | 'ARTICLE';
  value: string;
};

/**
 * Document-level facts extracted at indexing time (doc-gateway `/metadata`), used to filter the
 * library by attribute and to head each `library_search` result with a document card.
 *
 * Answers enumeration queries ("show ALL contracts with X / briefs from 2025") that retrieval
 * cannot: top-K does not fit a set. Measured (RESULTS_META.md): the production dense top-5 path
 * scores set-recall 0.54, a filter over these fields 1.00 at precision 1.00.
 *
 * Deliberately universal — no domain fields (landlord / lease subject): those do not carry over
 * to briefs, tables or regulations.
 *
 * Every field describes the document's OWN header (title, preamble, requisites), never its body:
 * a city or company named in the body is CONTENT, which hybrid search retrieves — treating it as
 * metadata drops the "contracts in Minsk" filter to 0.85 precision (measured). The extractor
 * also derives entities/dates/amounts across the whole zone; those are not persisted because no
 * filter or card uses them, and a partial list would silently lie to a filter.
 */
export type TDocMetadata = {
  /** What the document IS: договор / положение / бриф / таблица / приказ / … */
  docType: string;
  /** Counterparties named in the header preamble — what the card shows and `org` filters. */
  parties: string[];
  /** Date the document was drawn up, from its header — not any date it mentions. */
  primaryDate?: string | null;
  /** Place the document was drawn up, from its header. */
  primaryLocation?: string | null;
  identifiers: TDocIdentifier[];
  /** Column names of a row-structured file (CSV/XLSX); empty otherwise. */
  columns: string[];
};

export type TFile = {
  _id?: string;
  __v?: number;
  user: string;
  tenantId?: string;
  storageRegion?: string;
  storageKey?: string;
  conversationId?: string;
  message?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  embedded: boolean;
  /**
   * Async RAG embedding lifecycle (RAG_ASYNC_EMBED). `'pending'`/`'processing'`
   * while the background worker indexes the file into the vector store,
   * `'ready'` once searchable, `'failed'` if indexing gave up. `undefined`
   * for legacy records and synchronous uploads — clients MUST treat that as
   * ready (the file is already searchable).
   */
  embeddingStatus?: 'pending' | 'processing' | 'ready' | 'failed';
  /**
   * Why the file is embedded. `'chat'`/absent = participates in the chat
   * retrieval floor and file_search tool. `'library'` = a full-text context
   * document indexed only for cross-chat library_search; excluded from the
   * floor to avoid double injection over its inlined full text.
   */
  embeddingScope?: 'chat' | 'library';
  /**
   * Project this file is a source of. Such files are embedded under the project's own namespace
   * and are deliberately OUT of the cross-chat library, so the assistant only finds them inside
   * that project — the Files table must not promise otherwise.
   */
  project_id?: string;
  /**
   * Deadline after which the file is swept. Under `retentionMode: ALL` this is a retention
   * date EVERY file carries (the file is a live library document until then); on a temp-chat
   * file it is the privacy deadline. The `temporary` flag tells the two apart.
   */
  expiredAt?: string | Date | null;
  /**
   * Privacy marker written at upload time: `true` = temp-chat file, never cross-chat findable.
   * Absent on legacy records = unknown (the library scope treats those fail-closed when they
   * carry an expiry date).
   */
  temporary?: boolean;
  /**
   * Document-level facts extracted at indexing time. Absent on legacy records, on files whose
   * text could not be resolved, and on non-indexed files — clients MUST treat undefined as
   * "unknown", never as "no parties/no date".
   */
  docMetadata?: TDocMetadata;
  filename: string;
  filepath: string;
  object: 'file';
  type: string;
  usage: number;
  context?: FileContext;
  source?: FileSources;
  filterSource?: FileSources;
  width?: number;
  height?: number;
  expiresAt?: string | Date;
  preview?: string;
  text?: string;
  /**
   * Format of the `text` field. `'html'` means the backend produced
   * a sanitized full-document HTML preview the client may inject as
   * `index.html` inside the office artifact iframe. `'text'` (or
   * `undefined` for legacy records) is plain text and MUST NOT be
   * injected as HTML — render through the markdown/escaping path.
   * See Codex P1 review on PR #12934.
   */
  textFormat?: 'html' | 'text' | null;
  /**
   * Lifecycle of the inline preview rendered from `text`. `'pending'`
   * while background HTML extraction is in flight (deferred-preview
   * code-execution flow), `'ready'` once `text`/`textFormat` are set,
   * `'failed'` if extraction errored or hit the 60s ceiling. `undefined`
   * for legacy records and for files that never expect a preview —
   * clients MUST treat that as `'ready'`.
   */
  status?: 'pending' | 'ready' | 'failed';
  /**
   * Short machine-readable failure reason when `status === 'failed'`.
   * Suitable for tooltip text but not user-facing prose.
   */
  previewError?: string;
  /**
   * Preview-only sanitized office HTML rendered at upload for office-bucket
   * files taken down the full-text `context` path (which keeps only the
   * model's plain extracted `text` and discards the original). The preview
   * route surfaces this as `text` + `textFormat: 'html'`. Never read by the
   * model. Absent for every other record kind.
   */
  previewText?: string;
  metadata?: {
    fileIdentifier?: string;
    /**
     * Structured form of `fileIdentifier`. Persisted alongside the
     * legacy string during the dual-write transition; readers should
     * resolve via `resolveCodeEnvRef`.
     */
    codeEnvRef?: CodeEnvRef;
  };
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type TFileUpload = TFile & {
  temp_file_id: string;
};

/**
 * Shape returned by `GET /api/files/:file_id/preview`. The deferred-
 * preview code-execution flow polls this until status is terminal:
 *   - `pending`: HTML extraction is still running. No `text`.
 *   - `ready`: extraction succeeded; `text` + `textFormat` populated
 *     iff the file produced inline preview content (binary/oversized
 *     files reach `ready` with no text — render download-only).
 *   - `failed`: extraction errored or hit the 60s ceiling;
 *     `previewError` carries the short reason (`timeout`,
 *     `parser-error`, `orphaned`, etc.).
 *
 * Legacy records pre-dating the field are surfaced as `'ready'` server-
 * side so existing attachments keep rendering normally.
 */
export type TFilePreview = {
  file_id: string;
  status: 'pending' | 'ready' | 'failed';
  text?: string;
  textFormat?: 'html' | 'text' | null;
  previewError?: string;
};

export type AvatarUploadResponse = {
  url: string;
};

export type FileDownloadURLResponse = {
  url: string;
  filename: string;
  type: string;
  metadata: Partial<TFile>;
};

export type SpeechToTextResponse = {
  text: string;
};

export type VoiceResponse = string[];

export type UploadMutationOptions = {
  onSuccess?: (data: TFileUpload, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type UploadAvatarOptions = {
  onSuccess?: (data: AvatarUploadResponse, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type SpeechToTextOptions = {
  onSuccess?: (data: SpeechToTextResponse, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type TextToSpeechOptions = {
  onSuccess?: (data: ArrayBuffer, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type VoiceOptions = {
  onSuccess?: (data: VoiceResponse, variables: unknown, context?: unknown) => void;
  onMutate?: () => void | Promise<unknown>;
  onError?: (error: unknown, variables: unknown, context?: unknown) => void;
};

export type DeleteFilesResponse = {
  message: string;
  result: Record<string, unknown>;
};

export type BatchFile = {
  file_id: string;
  filepath: string;
  storageRegion?: string;
  storageKey?: string;
  embedded: boolean;
  source: FileSources;
  temp_file_id?: string;
};

export type DeleteFilesBody = {
  files: BatchFile[];
  agent_id?: string;
  assistant_id?: string;
  tool_resource?: EToolResources;
};

export type DeleteMutationOptions = {
  onSuccess?: (data: DeleteFilesResponse, variables: DeleteFilesBody, context?: unknown) => void;
  onMutate?: (variables: DeleteFilesBody) => void | Promise<unknown>;
  onError?: (error: unknown, variables: DeleteFilesBody, context?: unknown) => void;
};
