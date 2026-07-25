const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const {
  isEnabled,
  rerankOrder,
  logAxiosError,
  getRagRerankConfig,
  generateShortLivedToken,
  createConcurrencyLimiter,
} = require('@librechat/api');

const footer = `Use the context as your learned knowledge to better answer the user.

In your response, remember to follow these guidelines:
- If you don't know the answer, simply say that you don't know.
- If you are unsure how to answer, ask for clarification.
- Avoid mentioning that you obtained the information from the context.
`;

/**
 * Hard ceiling on a single RAG `/query` call. axios has no default timeout, so
 * without this a hung rag_api would hold the chat turn open indefinitely and
 * exhaust the connection pool. Overridable via env.
 */
const RAG_API_TIMEOUT_MS = parseInt(process.env.RAG_API_TIMEOUT_MS ?? '', 10) || 30000;

/**
 * Full-context (`/documents/:id/context`) returns a whole document rather than a
 * few chunks, so it gets its own, more generous ceiling (never shorter than the
 * per-query timeout).
 */
const RAG_CONTEXT_TIMEOUT_MS = Math.max(
  RAG_API_TIMEOUT_MS,
  parseInt(process.env.RAG_CONTEXT_TIMEOUT_MS ?? '', 10) || 60000,
);

/**
 * Bounds the concurrent `/query` fan-out so a conversation carrying many
 * embedded files cannot open an unbounded number of simultaneous RAG requests
 * (and saturate rag_api / the event loop) on every turn.
 */
const RAG_QUERY_CONCURRENCY = parseInt(process.env.RAG_QUERY_CONCURRENCY ?? '', 10) || 10;

function createContextHandlers(req, userMessageContent) {
  if (!process.env.RAG_API_URL) {
    return;
  }

  const processedFiles = [];
  const processedIds = new Set();
  const jwtToken = generateShortLivedToken(req.user.id);
  const useFullContext = isEnabled(process.env.RAG_USE_FULL_CONTEXT);
  /**
   * Forced-floor retrieval depth (chunks fetched per embedded file every turn).
   * Recall measured on real KFC lease contracts (parser-bench/rag-recall):
   * recall@4=0.90 vs recall@8=0.96 — most misses sat just outside k=4, so the
   * floor depth, not the embeddings, was the bottleneck. Default raised 4→8;
   * `RAG_FORCED_CONTEXT_K` tunes it without a rebuild.
   */
  const forcedFloorK = parseInt(process.env.RAG_FORCED_CONTEXT_K, 10) || 8;
  /**
   * Sovereign rerank on the forced-floor path. This retrieval runs every turn
   * for embedded files but, unlike file_search, was never reranked — yet its
   * small k is exactly where a cross-encoder helps most (UDA-bench: +7–13pp of
   * Top-1 evidence coverage on table-dense docs). When enabled we fetch a wider
   * candidate pool per file and keep the reranked top `forcedFloorK`. Disabled
   * (empty RAG_RERANKER_URL → null) = byte-for-byte the previous behavior, and
   * it never applies to whole-document full-context mode.
   */
  const rerankConfig = useFullContext ? null : getRagRerankConfig();
  const forcedFloorPoolK = rerankConfig
    ? Math.max(forcedFloorK, rerankConfig.candidates)
    : forcedFloorK;
  const limit = createConcurrencyLimiter(RAG_QUERY_CONCURRENCY);

  const query = (file) => {
    if (useFullContext) {
      return axios.get(`${process.env.RAG_API_URL}/documents/${file.file_id}/context`, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
        timeout: RAG_CONTEXT_TIMEOUT_MS,
      });
    }

    const body = {
      file_id: file.file_id,
      query: userMessageContent,
      k: forcedFloorPoolK,
    };
    /* Query the same entity namespace the file was embedded under (agent_id for
     * agent knowledge, project_id for legacy project sources). Mirrors the
     * file_search tool's precedence exactly (see fileSearch.js). Omitting it
     * makes `/query` search the default namespace, so a file embedded under a
     * non-default entity_id silently returns no chunks. */
    const entityId = file.embedEntityId ?? file.project_id ?? undefined;
    if (entityId) {
      body.entity_id = entityId;
    }

    return axios.post(`${process.env.RAG_API_URL}/query`, body, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
      },
      timeout: RAG_API_TIMEOUT_MS,
    });
  };

  /**
   * Order one file's candidate chunks and cut to the forced-floor depth. With
   * rerank enabled we asked rag_api for a wider pool (`forcedFloorPoolK`); the
   * cross-encoder reorders it and we keep the top `forcedFloorK`. Fail-open: a
   * null order (rerank disabled, fewer than 2 candidates, timeout, 5xx, or a
   * malformed body) keeps pgvector's distance order — degrading to exactly the
   * pre-rerank output (distance-ordered top-`forcedFloorK`). Order changes only;
   * chunk content is never altered.
   * @param {unknown} data raw `/query` response for one file (array of `[doc, distance]`).
   * @returns {Promise<Array>} ordered, sliced chunk rows for context assembly.
   */
  const rerankFileChunks = async (data) => {
    if (!rerankConfig) {
      return Array.isArray(data) ? data : [];
    }
    const rows = (Array.isArray(data) ? data : []).filter(
      (item) => item?.[0]?.page_content != null,
    );
    if (rows.length < 2) {
      return rows;
    }
    const order = await rerankOrder({
      config: rerankConfig,
      query: userMessageContent,
      documents: rows.map((item) => item[0].page_content),
      topN: forcedFloorK,
    });
    const ordered = order != null ? order.map(({ index }) => rows[index]) : rows;
    return ordered.slice(0, forcedFloorK);
  };

  const processFile = async (file) => {
    if (file.embedded && !processedIds.has(file.file_id)) {
      processedFiles.push(file);
      processedIds.add(file.file_id);
    }
  };

  /**
   * Runs every file's query under the concurrency cap, pairing each result with
   * its file. A single query failing (timeout, RAG outage, one bad file) must
   * NOT strip context from the other files, so each promise resolves to
   * `{ file, data }` with `data: null` on error instead of rejecting.
   */
  const runQueries = () =>
    Promise.all(
      processedFiles.map((file) =>
        limit(() => query(file))
          .then((response) => ({ file, data: response.data }))
          .catch((error) => {
            logAxiosError({
              message: `[createContext] RAG query failed for file ${file.file_id}`,
              error,
            });
            return { file, data: null };
          }),
      ),
    );

  const createContext = async () => {
    try {
      if (!processedFiles.length) {
        return '';
      }

      const oneFile = processedFiles.length === 1;
      const header = `The user has attached ${oneFile ? 'a' : processedFiles.length} file${
        !oneFile ? 's' : ''
      } to the conversation:`;

      const files = `${
        oneFile
          ? ''
          : `
      <files>`
      }${processedFiles
        .map(
          (file) => `
              <file>
                <filename>${file.filename}</filename>
                <type>${file.type}</type>
              </file>`,
        )
        .join('')}${
        oneFile
          ? ''
          : `
        </files>`
      }`;

      const results = await runQueries();
      const successful = results.filter((result) => result.data != null);

      if (successful.length === 0) {
        /* Every file's query failed (not "no hits" — those return an empty
         * array, which is not null). Degrade honestly instead of fabricating
         * an empty context block. */
        return '\n\tNote: the document search service was temporarily unavailable, so no context could be retrieved from the attached documents for this message.';
      }

      const contextBlocks = await Promise.all(
        successful.map(({ file, data }) =>
          limit(async () => {
            const generateContext = (currentContext) =>
              `
          <file>
            <filename>${file.filename}</filename>
            <context>${currentContext}
            </context>
          </file>`;

            if (useFullContext) {
              return generateContext(`\n${data}`);
            }

            const contextItems = (await rerankFileChunks(data))
              .map((item) => {
                const pageContent = item?.[0]?.page_content;
                if (pageContent == null) {
                  return '';
                }
                return `
            <contextItem>
              <![CDATA[${pageContent.trim()}]]>
            </contextItem>`;
              })
              .join('');

            return generateContext(contextItems);
          }),
        ),
      );
      const context = contextBlocks.join('');

      if (useFullContext) {
        const prompt = `${header}
          ${context}
          ${footer}`;

        return prompt;
      }

      const prompt = `${header}
        ${files}

        A semantic search was executed with the user's message as the query, retrieving the following context inside <context></context> XML tags.

        <context>${context}
        </context>

        ${footer}`;

      return prompt;
    } catch (error) {
      // The forced-floor retrieval runs on every turn for embedded files, so a
      // RAG outage here must NOT break the whole message. Degrade gracefully:
      // tell the model retrieval was unavailable instead of throwing.
      logger.error(
        '[createContext] document retrieval unavailable; answering without context:',
        error,
      );
      return '\n\tNote: the document search service was temporarily unavailable, so no context could be retrieved from the attached documents for this message.';
    }
  };

  return {
    processFile,
    createContext,
  };
}

module.exports = createContextHandlers;
