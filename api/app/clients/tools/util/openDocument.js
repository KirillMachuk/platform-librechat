const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const {
  countTokens,
  openDocumentSlice,
  openDocumentSchema,
  openDocumentDescription,
  resolveOpenDocumentTokenLimit,
} = require('@librechat/api');
const { Tools } = require('librechat-data-provider');
const { withLibraryVisibility } = require('./librarySearch');
const { getFiles } = require('~/models');

/**
 * Documents one turn may read in full. Sized for the real deep-dive cases — reviewing a
 * contract in several passes, or comparing two of them — while bounding what a single
 * answer can cost: every read spends context AND a slow first pass through the in-country
 * anonymizer. A bigger document is not lost at the cap, its remaining parts are read on
 * the next turn. Only successful reads count; a wrong id costs nothing so the model can
 * correct itself.
 */
const MAX_OPEN_CALLS_PER_TURN = 6;

/**
 * Per-turn read counters, keyed by the request object. The counter CANNOT live in the tool
 * instance: on the event-driven path the runtime re-invokes `loadTools` for every execution
 * round, so a fresh instance (and a zeroed closure counter) would appear each round and the
 * cap would never fire — exactly where it matters most, since one turn spans many rounds.
 * The request object is the one identity that survives the whole turn; WeakMap keeps the
 * entry from outliving it.
 */
const readsByRequest = new WeakMap();

/**
 * Second half of the two-step document workflow: `library_search` finds documents,
 * `open_document` reads one in full — the same extracted text, budget and tokenizer used
 * when a user attaches the file to the chat (`extractFileContext`), with an added offset
 * so a long contract can be read across calls.
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} [options.tenantId]
 * @param {ServerRequest} [options.req] Supplies the file token budget for this request.
 */
const createOpenDocumentTool = async ({ userId, tenantId, req, conversationFileIds = [] }) => {
  const tokenLimit = resolveOpenDocumentTokenLimit(req);
  const counterKey = req ?? {};
  const attachedIds = new Set(Array.isArray(conversationFileIds) ? conversationFileIds : []);

  return tool(
    async ({ document_id, offset }) => {
      const documentId = typeof document_id === 'string' ? document_id.trim() : '';
      if (!documentId) {
        return 'Provide the "Document ID" of a document from library_search results.';
      }
      const reads = readsByRequest.get(counterKey) ?? 0;
      if (reads >= MAX_OPEN_CALLS_PER_TURN) {
        return `Read limit reached for this turn (${MAX_OPEN_CALLS_PER_TURN} reads). Answer from what you have already read; if part of a document is still unread, tell the user you can continue reading it in the next message.`;
      }

      /* The id comes FROM THE MODEL, so it is never trusted: the file is re-fetched under
       * the requesting user's own scope (plus the tenant belt-and-suspenders used by every
       * other document query). A file belonging to someone else simply does not resolve.
       *
       * Ownership alone is not enough — the same visibility rule as the search applies. A
       * bare owner query would read what the search deliberately hides: a temp-chat file
       * from ANOTHER chat (temp chats promise to leave no trace) or a retention-expired
       * document awaiting sweep. Files the user attached to THIS chat bypass the gate,
       * mirroring primeLibraryScope: an explicit attachment is in scope even when a blind
       * library sweep would exclude it. */
      const ownerScope = {
        file_id: documentId,
        user: userId,
        ...(tenantId != null ? { tenantId } : {}),
      };
      let files;
      try {
        files = await getFiles(
          attachedIds.has(documentId) ? ownerScope : withLibraryVisibility(ownerScope),
          null,
          { file_id: 1, filename: 1, text: 1, fullText: 1 },
          1,
        );
      } catch (error) {
        logger.error(`[${Tools.open_document}] lookup failed`, error);
        return 'The document could not be opened due to an unexpected error.';
      }

      const file = files?.[0];
      if (!file) {
        return `No document with ID "${documentId.slice(0, 60)}" is available. Use library_search first and copy the "Document ID" exactly as printed in its results.`;
      }

      /* `text` is set on documents read as full text; `fullText` on those routed to RAG,
       * where `text` is deliberately absent so the attachment path never inlines them.
       * Either one is "the document's text" as far as reading goes. */
      const documentText = file.text || file.fullText;

      /* Reading is inside the try for the same reason the lookup is: an exception escaping a
       * tool aborts the whole chat turn, while a returned string degrades into something the
       * model can relay. Tokenising a 200k-character contract is the realistic failure here. */
      let slice;
      try {
        slice = await openDocumentSlice({
          documentId,
          filename: file.filename ?? 'unknown',
          text: documentText,
          offset,
          tokenLimit,
          tokenCountFn: (text) => countTokens(text),
        });
      } catch (error) {
        logger.error(`[${Tools.open_document}] read failed`, error);
        return 'The document could not be read due to an unexpected error.';
      }

      const nextReads = documentText ? reads + 1 : reads;
      if (documentText) {
        readsByRequest.set(counterKey, nextReads);
      }
      /* PII-safe: answers "was it called, on what, and did it hit the cap" without content.
       * The exact character range read is on the debug line inside openDocumentSlice. */
      logger.info(
        `[${Tools.open_document}] file=${documentId} total=${documentText?.length ?? 0} offset=${Math.trunc(Number(offset)) || 0} reads=${nextReads}/${MAX_OPEN_CALLS_PER_TURN}`,
      );
      return slice;
    },
    {
      name: Tools.open_document,
      description: openDocumentDescription,
      schema: openDocumentSchema,
    },
  );
};

module.exports = {
  createOpenDocumentTool,
  MAX_OPEN_CALLS_PER_TURN,
};
