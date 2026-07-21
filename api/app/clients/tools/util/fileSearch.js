const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const {
  logAxiosError,
  generateShortLivedToken,
  createConcurrencyLimiter,
  getRagRerankConfig,
  rerankOrder,
} = require('@librechat/api');
const { Tools, EToolResources } = require('librechat-data-provider');
const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
const { getFiles } = require('~/models');

const fileSearchJsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        "A natural language query to search for relevant information in the files. Be specific and use keywords related to the information you're looking for. The query will be used for semantic similarity matching against the file contents.",
    },
  },
  required: ['query'],
};

/**
 * Clamps an env-provided integer to [1, max], falling back to `fallback` when the
 * value is missing or non-numeric. Bounds admin-set knobs so a mistaken large
 * value (e.g. FILE_SEARCH_K=2000) can't push the RAG query into timeout/OOM or
 * blow up the LLM context.
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
const clampEnvInt = (raw, fallback, max) => {
  const parsed = parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
};

/** Upper bound for chunks-per-file: beyond this, RAG latency/OOM risk outweighs recall. */
const FILE_SEARCH_K_MAX = 50;
/** Upper bound for merged results kept: caps how much retrieved text reaches the LLM context. */
const FILE_SEARCH_RESULT_LIMIT_MAX = 100;

/**
 * Chunks requested per file from the RAG API. Higher values improve recall for
 * clause-location and "quote the section" queries on contracts/tables, at the
 * cost of more context. Overridable via env (clamped to FILE_SEARCH_K_MAX).
 */
const FILE_SEARCH_K = clampEnvInt(process.env.FILE_SEARCH_K, 12, FILE_SEARCH_K_MAX);

/**
 * Maximum chunks kept after merging and ranking results across all files.
 * Overridable via env (clamped to FILE_SEARCH_RESULT_LIMIT_MAX).
 */
const FILE_SEARCH_RESULT_LIMIT = clampEnvInt(
  process.env.FILE_SEARCH_RESULT_LIMIT,
  20,
  FILE_SEARCH_RESULT_LIMIT_MAX,
);

/**
 * Hard ceiling on a single RAG `/query` call. axios has no default timeout, so
 * a hung rag_api would otherwise hold the tool call (and the chat turn) open
 * indefinitely. Same env knob as the forced-floor context path.
 */
const RAG_API_TIMEOUT_MS = parseInt(process.env.RAG_API_TIMEOUT_MS ?? '', 10) || 30000;

/**
 * Bounds the concurrent `/query` fan-out so an agent with many knowledge files
 * cannot open an unbounded number of simultaneous RAG requests per invocation.
 */
const RAG_QUERY_CONCURRENCY = parseInt(process.env.RAG_QUERY_CONCURRENCY ?? '', 10) || 10;

/**
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {Agent['tool_resources']} options.tool_resources
 * @param {string} [options.agentId] - The agent ID for file access control
 * @returns {Promise<{
 *   files: Array<{ file_id: string; filename: string }>,
 *   toolContext: string
 * }>}
 */
const primeFiles = async (options) => {
  const { tool_resources, req, agentId } = options;
  const file_ids = tool_resources?.[EToolResources.file_search]?.file_ids ?? [];
  const agentResourceIds = new Set(file_ids);
  const resourceFiles = tool_resources?.[EToolResources.file_search]?.files ?? [];

  // Get all files first
  const allFiles =
    (await getFiles({ file_id: { $in: file_ids } }, null, { text: 0, fullText: 0 })) ?? [];

  // Project source files are pre-authorised: applyProjectContext already called
  // db.getProjectById(userId, projectId) before injecting them, so membership
  // is established. Passing them through filterFilesByAgentAccess would block
  // files uploaded by a different project member (agent ownership ≠ project
  // membership). Split and bypass the agent check for project files.
  const projectFiles = allFiles.filter((f) => f.project_id);
  const agentFiles = allFiles.filter((f) => !f.project_id);

  let accessibleAgentFiles;
  if (req?.user?.id && agentId && agentFiles.length > 0) {
    accessibleAgentFiles = await filterFilesByAgentAccess({
      files: agentFiles,
      userId: req.user.id,
      role: req.user.role,
      agentId,
    });
  } else {
    accessibleAgentFiles = agentFiles;
  }

  let dbFiles = [...projectFiles, ...accessibleAgentFiles];

  dbFiles = dbFiles.concat(resourceFiles);

  let toolContext = `- Note: Semantic search is available through the ${Tools.file_search} tool but no files are currently loaded. Request the user to upload documents to search through.`;

  const files = [];
  for (let i = 0; i < dbFiles.length; i++) {
    const file = dbFiles[i];
    if (!file) {
      continue;
    }
    if (i === 0) {
      toolContext =
        `- Use the ${Tools.file_search} tool to read the document(s) listed below. They may be ` +
        `scanned or large and have NO inline text in this chat — ${Tools.file_search} is the ONLY ` +
        `way to access their contents.\n` +
        `- You MUST call ${Tools.file_search} before answering ANY question about them, including ` +
        `follow-up and locating questions (e.g. "where is it stated", "quote the clause", "which ` +
        `section/page", "who are the parties"). Re-run it for each new question with a focused query.\n` +
        `- NEVER tell the user the document could not be read or that its text was not extracted, and ` +
        `NEVER ask them to paste text or send a screenshot — search the document instead.\n` +
        `- Do not retract an earlier answer that came from ${Tools.file_search} just because the text ` +
        `is not visible in the chat.\n` +
        `- Available documents:`;
    }
    /* Async embedding (RAG_ASYNC_EMBED): a file whose background embed has
     * not finished is announced honestly and excluded from the query list —
     * otherwise the agent promises a document the vector store cannot see
     * yet and tells the user the document is empty. */
    const embedIncomplete =
      file.embeddingStatus === 'pending' || file.embeddingStatus === 'processing';
    const embedFailed = file.embeddingStatus === 'failed';
    toolContext += `\n\t- ${file.filename}${
      agentResourceIds.has(file.file_id) ? '' : ' (just attached by user)'
    }${
      embedIncomplete
        ? ' — STILL INDEXING, not searchable yet; tell the user to retry in a few minutes'
        : ''
    }${embedFailed ? ' — indexing FAILED, contents are not searchable' : ''}`;
    if (embedIncomplete || embedFailed) {
      continue;
    }
    files.push({
      file_id: file.file_id,
      filename: file.filename,
      // Preserve the entity namespace the file was embedded under so that
      // the RAG /query call uses the same entity_id that /embed used.
      // `embedEntityId` is the namespace the async embed worker used
      // (agent_id for agent knowledge, project_id for project sources);
      // prefer it so the query matches the embed explicitly instead of
      // relying on the tool-level fallback. Falls back to project_id for
      // legacy/sync records that predate the field.
      entity_id: file.embedEntityId ?? file.project_id ?? undefined,
    });
  }

  return { files, toolContext };
};

/**
 * @param {Object} options
 * @param {string} options.userId
 * @param {Array<{ file_id: string; filename: string }>} options.files
 * @param {string} [options.entity_id]
 * @param {boolean} [options.fileCitations=false] - Whether to include citation instructions
 * @param {(content: string) => Promise<string>} [options.transformContent] Sovereign DR (Track B):
 *   masks the retrieved document text (the user's own PII) before it egresses to the model. Applied
 *   ONLY to the model-visible content; if it rejects, the caller must drop the chunk (never send raw).
 * @returns
 */
const createFileSearchTool = async ({
  userId,
  files,
  entity_id,
  fileCitations = false,
  transformContent,
}) => {
  return tool(
    async ({ query }) => {
      if (files.length === 0) {
        return ['No files to search. Instruct the user to add files for the search.', undefined];
      }
      const jwtToken = generateShortLivedToken(userId);
      if (!jwtToken) {
        return ['There was an error authenticating the file search request.', undefined];
      }

      /* Суверенный реранк (RAG_RERANKER_URL, фаза 3a): при включённом реранке запрашиваем у
       * rag_api БОЛЬШЕ кандидатов на файл — расширенный пул и есть источник качества (реранк
       * только штатных k бесполезен: все чанки и так уйдут в контекст). Выключен = ровно
       * прежнее поведение. */
      const rerankConfig = getRagRerankConfig();
      const perFileK = rerankConfig
        ? Math.max(FILE_SEARCH_K, rerankConfig.candidates)
        : FILE_SEARCH_K;

      /**
       * @param {import('librechat-data-provider').TFile} file
       * @returns {{ file_id: string, query: string, k: number, entity_id?: string }}
       */
      const createQueryBody = (file) => {
        const body = {
          file_id: file.file_id,
          query,
          k: perFileK,
        };
        // Per-file entity_id (e.g. project_id for project source files) takes
        // priority over the tool-level entity_id (agent id). This ensures that
        // project files embedded under entity_id=project_id are queried in the
        // correct RAG namespace rather than the agent's namespace.
        const effectiveEntityId = file.entity_id ?? entity_id;
        if (!effectiveEntityId) {
          return body;
        }
        body.entity_id = effectiveEntityId;
        logger.debug(`[${Tools.file_search}] RAG API /query body`, body);
        return body;
      };

      // Carry each file alongside its result so a dropped (failed) query cannot
      // shift the array index and misattribute file_id/page to the wrong file —
      // filtering nulls below would otherwise desync `files[fileIndex]`.
      const limit = createConcurrencyLimiter(RAG_QUERY_CONCURRENCY);
      const queryPromises = files.map((file) =>
        limit(() =>
          axios.post(`${process.env.RAG_API_URL}/query`, createQueryBody(file), {
            headers: {
              Authorization: `Bearer ${jwtToken}`,
              'Content-Type': 'application/json',
            },
            timeout: RAG_API_TIMEOUT_MS,
          }),
        )
          .then((response) => ({ file, data: response.data }))
          .catch((error) => {
            logAxiosError({
              message: `[${Tools.file_search}] query failed for file ${file.file_id}`,
              error,
            });
            return null;
          }),
      );

      const results = await Promise.all(queryPromises);
      const validResults = results.filter((result) => result !== null);

      if (validResults.length === 0) {
        // Every per-file query returned null (each rejection is caught above), so
        // this branch means the RAG service could not be reached — not "no hits".
        return [
          'The document search service is temporarily unavailable. Please try again shortly.',
          undefined,
        ];
      }

      // D5/D16: carry each file with its result ({file,data}) so a dropped
      // (failed) query cannot shift the array index and misattribute file_id/page
      // to the wrong file; tolerate a malformed/error-shaped payload instead of
      // throwing a TypeError that would crash the whole tool call. Produce the
      // distance-sorted merged pool WITHOUT slicing yet — the reranker (#105)
      // needs the full candidate pool before the final cut.
      const mergedResults = validResults
        .flatMap(({ file, data }) => {
          const rows = Array.isArray(data) ? data : [];
          return rows
            .filter((item) => item?.[0]?.page_content != null)
            .map((item) => {
              const [docInfo, distance] = item;
              return {
                filename: docInfo.metadata?.source?.split('/').pop() ?? file.filename ?? 'unknown',
                content: docInfo.page_content,
                distance,
                file_id: file.file_id,
                page: docInfo.metadata?.page || null,
              };
            });
        })
        .sort((a, b) => a.distance - b.distance);

      /* Кросс-файловый реранк расширенного пула cross-encoder'ом: pgvector-порядок шумный
       * (нужный пункт договора часто на 5-9 месте), реранкер ставит его в топ. Fail-open:
       * null (выключен/таймаут/5xx) → остаёмся на порядке по дистанции. Реранк меняет ТОЛЬКО
       * ПОРЯДОК; метка Relevance остаётся дистанционной (1-distance). Живой A/B (урок 6
       * RERANKER_Plan): подмена метки rerank-скором буквально сказала модели «(неверный) кусок
       * самый релевантный» и увела её в соседний пункт — честная per-chunk оценка ретривера
       * плюс лучший порядок дают выигрыш без этого рычага вреда. */
      let rankedResults = mergedResults;
      if (rerankConfig && mergedResults.length > 1) {
        const pool = mergedResults.slice(0, rerankConfig.candidates);
        const order = await rerankOrder({
          config: rerankConfig,
          query,
          documents: pool.map((result) => result.content),
          topN: FILE_SEARCH_RESULT_LIMIT,
        });
        if (order != null) {
          rankedResults = order.map(({ index }) => pool[index]);
        }
      }

      const formattedResults = rankedResults.slice(0, FILE_SEARCH_RESULT_LIMIT);

      if (formattedResults.length === 0) {
        return [
          'No content found in the files. The files may not have been processed correctly or you may need to refine your query.',
          undefined,
        ];
      }

      const relevanceOf = (result) => result.relevance ?? 1.0 - result.distance;

      const formattedString = formattedResults
        .map(
          (result, index) =>
            `File: ${result.filename}${
              fileCitations ? `\nAnchor: \\ue202turn0file${index} (${result.filename})` : ''
            }\nRelevance: ${relevanceOf(result).toFixed(4)}\nContent: ${result.content}\n`,
        )
        .join('\n---\n');

      const sources = formattedResults.map((result) => ({
        type: 'file',
        fileId: result.file_id,
        content: result.content,
        fileName: result.filename,
        relevance: relevanceOf(result),
        pages: result.page ? [result.page] : [],
        pageRelevance: result.page ? { [result.page]: relevanceOf(result) } : {},
      }));

      // Sovereign DR (Track B): mask the user's document text (the only PII-bearing part the
      // model sees) before it egresses. The artifact is UI-only — the user's own data shown
      // back to them — so it stays raw. Only this final return carries chunk content; the
      // early returns above are static, PII-free strings that need no masking.
      const content = transformContent ? await transformContent(formattedString) : formattedString;
      return [content, { [Tools.file_search]: { sources, fileCitations } }];
    },
    {
      name: Tools.file_search,
      responseFormat: 'content_and_artifact',
      description: `Performs semantic search across attached "${Tools.file_search}" documents using natural language queries. This tool analyzes the content of uploaded files to find relevant information, quotes, and passages that best match your query. Use this to extract specific information or find relevant sections within the available documents.${
        fileCitations
          ? `

**CITE FILE SEARCH RESULTS:**
Use the EXACT anchor markers shown below (copy them verbatim) immediately after statements derived from file content. Reference the filename in your text:
- File citation: "The document.pdf states that... \\ue202turn0file0"  
- Page reference: "According to report.docx... \\ue202turn0file1"
- Multi-file: "Multiple sources confirm... \\ue200\\ue202turn0file0\\ue202turn0file1\\ue201"

**CRITICAL:** Output these escape sequences EXACTLY as shown (e.g., \\ue202turn0file0). Do NOT substitute with other characters like † or similar symbols.
**ALWAYS mention the filename in your text before the citation marker. NEVER use markdown links or footnotes.**`
          : ''
      }`,
      schema: fileSearchJsonSchema,
    },
  );
};

module.exports = {
  createFileSearchTool,
  primeFiles,
  fileSearchJsonSchema,
  clampEnvInt,
  FILE_SEARCH_K,
  FILE_SEARCH_RESULT_LIMIT,
};
