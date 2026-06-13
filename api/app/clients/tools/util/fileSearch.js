const axios = require('axios');
const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const { generateShortLivedToken } = require('@librechat/api');
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
 * Chunks requested per file from the RAG API. Higher values improve recall for
 * clause-location and "quote the section" queries on contracts/tables, at the
 * cost of more context. Overridable via env without a code change.
 */
const FILE_SEARCH_K = parseInt(process.env.FILE_SEARCH_K ?? '', 10) || 12;

/**
 * Maximum chunks kept after merging and ranking results across all files.
 */
const FILE_SEARCH_RESULT_LIMIT = parseInt(process.env.FILE_SEARCH_RESULT_LIMIT ?? '', 10) || 20;

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
  const allFiles = (await getFiles({ file_id: { $in: file_ids } }, null, { text: 0 })) ?? [];

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
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {Array<{ file_id: string; filename: string }>} options.files
 * @param {string} [options.entity_id]
 * @param {boolean} [options.fileCitations=false] - Whether to include citation instructions
 * @returns
 */
const createFileSearchTool = async ({ userId, files, entity_id, fileCitations = false }) => {
  return tool(
    async ({ query }) => {
      if (files.length === 0) {
        return ['No files to search. Instruct the user to add files for the search.', undefined];
      }
      const jwtToken = generateShortLivedToken(userId);
      if (!jwtToken) {
        return ['There was an error authenticating the file search request.', undefined];
      }

      /**
       * @param {import('librechat-data-provider').TFile} file
       * @returns {{ file_id: string, query: string, k: number, entity_id?: string }}
       */
      const createQueryBody = (file) => {
        const body = {
          file_id: file.file_id,
          query,
          k: FILE_SEARCH_K,
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

      const queryPromises = files.map((file) =>
        axios
          .post(`${process.env.RAG_API_URL}/query`, createQueryBody(file), {
            headers: {
              Authorization: `Bearer ${jwtToken}`,
              'Content-Type': 'application/json',
            },
          })
          .catch((error) => {
            logger.error('Error encountered in `file_search` while querying file:', error);
            return null;
          }),
      );

      const results = await Promise.all(queryPromises);
      const validResults = results.filter((result) => result !== null);

      if (validResults.length === 0) {
        return ['No results found or errors occurred while searching the files.', undefined];
      }

      const formattedResults = validResults
        .flatMap((result, fileIndex) =>
          result.data.map(([docInfo, distance]) => ({
            filename: docInfo.metadata.source.split('/').pop(),
            content: docInfo.page_content,
            distance,
            file_id: files[fileIndex]?.file_id,
            page: docInfo.metadata.page || null,
          })),
        )
        .sort((a, b) => a.distance - b.distance)
        .slice(0, FILE_SEARCH_RESULT_LIMIT);

      if (formattedResults.length === 0) {
        return [
          'No content found in the files. The files may not have been processed correctly or you may need to refine your query.',
          undefined,
        ];
      }

      const formattedString = formattedResults
        .map(
          (result, index) =>
            `File: ${result.filename}${
              fileCitations ? `\nAnchor: \\ue202turn0file${index} (${result.filename})` : ''
            }\nRelevance: ${(1.0 - result.distance).toFixed(4)}\nContent: ${result.content}\n`,
        )
        .join('\n---\n');

      const sources = formattedResults.map((result) => ({
        type: 'file',
        fileId: result.file_id,
        content: result.content,
        fileName: result.filename,
        relevance: 1.0 - result.distance,
        pages: result.page ? [result.page] : [],
        pageRelevance: result.page ? { [result.page]: 1.0 - result.distance } : {},
      }));

      return [formattedString, { [Tools.file_search]: { sources, fileCitations } }];
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

module.exports = { createFileSearchTool, primeFiles, fileSearchJsonSchema };
