const { nanoid } = require('nanoid');
const { Tools } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const { GenerationJobManager, prefetchFavicons } = require('@librechat/api');

/**
 * Helper to write attachment events either to res or to job emitter.
 * @param {import('http').ServerResponse} res - The server response object
 * @param {string | null} streamId - The stream ID for resumable mode, or null for standard mode
 * @param {Object} attachment - The attachment data
 */
function writeAttachment(res, streamId, attachment) {
  if (streamId) {
    GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
  } else {
    res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
  }
}

/**
 * Creates a function to handle search results and stream them as attachments
 * @param {import('http').ServerResponse} res - The HTTP server response object
 * @param {string | null} [streamId] - The stream ID for resumable mode, or null for standard mode
 * @returns {{ onSearchResults: function(SearchResult, GraphRunnableConfig): void; onGetHighlights: function(string): void}} - Function that takes search results and returns or streams an attachment
 */
function createOnSearchResults(res, streamId = null) {
  const context = {
    sourceMap: new Map(),
    searchResultData: undefined,
    toolCallId: undefined,
    attachmentName: undefined,
    messageId: undefined,
    conversationId: undefined,
  };

  /**
   * @param {SearchResult} results
   * @param {GraphRunnableConfig} runnableConfig
   */
  function onSearchResults(results, runnableConfig) {
    logger.info(
      `[onSearchResults] user: ${runnableConfig.metadata.user_id} | thread_id: ${runnableConfig.metadata.thread_id} | run_id: ${runnableConfig.metadata.run_id}`,
      results,
    );

    if (!results.success) {
      logger.error(
        `[onSearchResults] user: ${runnableConfig.metadata.user_id} | thread_id: ${runnableConfig.metadata.thread_id} | run_id: ${runnableConfig.metadata.run_id} | error: ${results.error}`,
      );
      return;
    }

    const turn = runnableConfig.toolCall?.turn ?? 0;
    const data = { turn, ...structuredClone(results.data ?? {}) };
    context.searchResultData = data;

    /* `context.sourceMap` lives for the whole request and is never cleared, so by
     * the ninth sub-question of a research run it holds every earlier search too.
     * The icons are warmed from THIS result instead: handing over the accumulated
     * map would spend the whole warming budget on sites already held and leave the
     * new ones — the only ones that cost the reader anything — cold. */
    const freshLinks = [];
    for (let i = 0; i < data.organic.length; i++) {
      const source = data.organic[i];
      if (source.link) {
        context.sourceMap.set(source.link, {
          type: 'organic',
          index: i,
          turn,
        });
        freshLinks.push(source.link);
      }
    }
    for (let i = 0; i < data.topStories.length; i++) {
      const source = data.topStories[i];
      if (source.link) {
        context.sourceMap.set(source.link, {
          type: 'topStories',
          index: i,
          turn,
        });
        freshLinks.push(source.link);
      }
    }

    /* The sources are on their way to the screen; their icons are not. We know
     * the domains here, seconds (in Deep Research, minutes) before the browser
     * asks for them, so the icons are fetched now instead of while someone waits
     * for them. Fire-and-forget by contract — nothing on this path may wait. */
    try {
      prefetchFavicons(freshLinks);
    } catch (error) {
      logger.warn('[onSearchResults] could not warm the source icons', error);
    }

    context.toolCallId = runnableConfig.toolCall.id;
    context.messageId = runnableConfig.metadata.run_id;
    context.conversationId = runnableConfig.metadata.thread_id;
    context.attachmentName = `${runnableConfig.toolCall.name}_${context.toolCallId}_${nanoid()}`;

    const attachment = buildAttachment(context);

    if (!res.headersSent) {
      return attachment;
    }
    writeAttachment(res, streamId, attachment);
  }

  /**
   * @param {string} link
   * @returns {void}
   */
  function onGetHighlights(link) {
    const source = context.sourceMap.get(link);
    if (!source) {
      return;
    }
    const { type, index } = source;
    const data = context.searchResultData;
    if (!data) {
      return;
    }
    if (data[type][index] != null) {
      data[type][index].processed = true;
    }

    const attachment = buildAttachment(context);
    writeAttachment(res, streamId, attachment);
  }

  return {
    onSearchResults,
    onGetHighlights,
  };
}

/**
 * Helper function to build an attachment object
 * @param {object} context - The context containing attachment data
 * @returns {object} - The attachment object
 */
function buildAttachment(context) {
  return {
    messageId: context.messageId,
    toolCallId: context.toolCallId,
    conversationId: context.conversationId,
    name: context.attachmentName,
    type: Tools.web_search,
    [Tools.web_search]: context.searchResultData,
  };
}

module.exports = {
  createOnSearchResults,
};
