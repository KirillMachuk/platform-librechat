const { logger } = require('@librechat/data-schemas');
const { Constants, ViolationTypes, isEphemeralAgentId } = require('librechat-data-provider');
const {
  sendEvent,
  getViolationInfo,
  buildMessageFiles,
  resolveTitleTiming,
  HEARTBEAT_INTERVAL_MS,
  GenerationJobManager,
  filterPersistableAbortContent,
  decrementPendingRequest,
  sanitizeMessageForTransmit,
  checkAndIncrementPendingRequest,
  isUnpersistedPreliminaryParent,
} = require('@librechat/api');
const { disposeClient, clientRegistry, requestDataMap } = require('~/server/cleanup');
const {
  getMCPRequestContext,
  cleanupMCPRequestContextForReq,
} = require('~/server/services/MCPRequestContext');
const { handleAbortError } = require('~/server/middleware');
const { logViolation } = require('~/cache');
const { saveMessage, getMessages, getConvo } = require('~/models');
const {
  runNewDeepResearch,
  isDrFollowUp,
  buildDrTurnContext,
} = require('~/server/services/Endpoints/agents/deepResearchRun');

function createCloseHandler(abortController) {
  return function (manual) {
    if (!manual) {
      logger.debug('[AgentController] Request closed');
    }
    if (!abortController) {
      return;
    } else if (abortController.signal.aborted) {
      return;
    } else if (abortController.requestCompleted) {
      return;
    }

    abortController.abort();
    logger.debug('[AgentController] Request aborted on close');
  };
}

function toValidISOString(value) {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function resolveConversationCreatedAt({ userId, conversationId, isNewConvo }) {
  if (isNewConvo) {
    return { createdAt: new Date().toISOString(), conversation: undefined };
  }

  try {
    const conversation = await getConvo(userId, conversationId);
    return {
      conversation,
      createdAt: toValidISOString(conversation?.createdAt) ?? new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('[AgentController] Failed to resolve conversation timestamp anchor', {
      conversationId,
      error: error?.message ?? error,
    });
    return { createdAt: new Date().toISOString(), conversation: undefined };
  }
}

async function attachConversationCreatedAt(req, { userId, conversationId, isNewConvo }) {
  req.body.conversationId = conversationId;
  const resolved = await resolveConversationCreatedAt({
    userId,
    conversationId,
    isNewConvo,
  });
  req.conversationCreatedAt = resolved.createdAt;
  if (!isNewConvo && resolved.conversation !== undefined) {
    req.resolvedConversation = resolved.conversation ?? null;
  }
}

function getPreliminaryResponseMessageId({ messageId, responseMessageId }) {
  if (typeof responseMessageId === 'string' && responseMessageId.length > 0) {
    return responseMessageId;
  }

  if (typeof messageId !== 'string' || messageId.length === 0) {
    return null;
  }

  return `${messageId.replace(/_+$/, '')}_`;
}

function getPreliminaryUserMessage(
  { messageId, parentMessageId, text, isRegenerate, overrideParentMessageId },
  conversationId,
) {
  /** Stock parity (BaseClient.setMessageOptions): a REGENERATE reuses the EXISTING user
   *  message — its id arrives as `overrideParentMessageId`, while `body.messageId` is a
   *  fresh client placeholder. Building from the placeholder made the DR runner save a
   *  DUPLICATE user message and branch the tree at the user level (live bug: the user
   *  bubble "disappeared" behind a 2/2 sibling switcher after regenerating a plan card). */
  const effectiveMessageId =
    isRegenerate === true ? (overrideParentMessageId ?? messageId) : messageId;
  if (typeof effectiveMessageId !== 'string' || effectiveMessageId.length === 0) {
    return null;
  }

  return {
    messageId: effectiveMessageId,
    parentMessageId,
    conversationId,
    text,
    sender: 'User',
    isCreatedByUser: true,
  };
}

function getRequestModelSpec(req, endpointOption) {
  const spec = endpointOption?.spec ?? req.body?.spec;
  if (typeof spec !== 'string' || spec.length === 0) {
    return;
  }

  const list = req.config?.modelSpecs?.list;
  if (!Array.isArray(list)) {
    return;
  }

  return list.find((modelSpec) => modelSpec?.name === spec);
}

function getModelSpecIconURL(modelSpec) {
  return modelSpec?.iconURL ?? modelSpec?.preset?.iconURL ?? modelSpec?.preset?.endpoint ?? '';
}

function getEndpointIconURL(req, endpointOption) {
  const iconURL =
    endpointOption?.iconURL ?? getModelSpecIconURL(getRequestModelSpec(req, endpointOption));
  return iconURL || undefined;
}

function getEndpointResponseModel(endpointOption) {
  return endpointOption?.modelOptions?.model || endpointOption?.model_parameters?.model;
}

function getAgentResponseModel(req, endpointOption) {
  const agentId = endpointOption?.agent_id || req.body?.agent_id;
  if (typeof agentId === 'string' && agentId.length > 0 && !isEphemeralAgentId(agentId)) {
    return agentId;
  }

  return getEndpointResponseModel(endpointOption);
}

async function finishResumableRequest(req, userId) {
  try {
    await cleanupMCPRequestContextForReq(req);
  } finally {
    await decrementPendingRequest(userId);
  }
}

function rejectPreliminaryParentMessageId(res) {
  return res.status(409).json({
    error:
      'Cannot submit a follow-up while the selected parent response is still being saved. Please wait and try again.',
  });
}

/**
 * Resumable Agent Controller - Generation runs independently of HTTP connection.
 * Returns streamId immediately, client subscribes separately via SSE.
 */
const ResumableAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  const userId = req.user.id;

  if (
    await isUnpersistedPreliminaryParent({
      userId,
      conversationId: reqConversationId,
      parentMessageId,
      getMessages,
    })
  ) {
    return rejectPreliminaryParentMessageId(res);
  }

  /** When to generate the conversation title. `immediate` (default) fires title
   *  generation in parallel with the response, from the user's first message;
   *  `final` defers it until the full response completes (legacy behavior).
   *  Resolved from the agent's actual endpoint once the client is initialized. */
  let titleTiming = 'immediate';

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const isNewConvo = !reqConversationId || reqConversationId === 'new';
  const conversationId = isNewConvo ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;
  req.body.conversationId = conversationId;

  /** Task #21 routing, resolved BEFORE the job is created (review r2): badge OR a reply
   *  to a persisted DR turn (drKind-gated plan/clarify parent). Hoisting it here lets a
   *  DR turn refuse a same-conversation double-submit WITHOUT replacing the live job —
   *  createJob would silently swap the runtime out from under the running research,
   *  orphan its AbortController, and let the first finalize kill the second run. */
  const useNewDeepResearch =
    req.config?.deepResearch?.useNewEngine === true &&
    (req.body?.ephemeralAgent?.deep_research === true ||
      (await isDrFollowUp({ userId, conversationId, parentMessageId })));

  if (useNewDeepResearch && !isNewConvo) {
    const activeStatus = await GenerationJobManager.getJobStatus(streamId);
    if (activeStatus === 'running') {
      logger.warn(
        `[ResumableAgentController] DR turn refused: a generation is already running for ${conversationId}`,
      );
      return res.status(409).json({
        error:
          'В этом чате уже идёт генерация. Дождитесь её завершения или остановите её, затем повторите.',
      });
    }
  }

  const { allowed, pendingRequests, limit } = await checkAndIncrementPendingRequest(userId);
  if (!allowed) {
    const violationInfo = getViolationInfo(pendingRequests, limit);
    await logViolation(req, res, ViolationTypes.CONCURRENT, violationInfo, violationInfo.score);
    return res.status(429).json(violationInfo);
  }

  let client = null;

  try {
    logger.debug(`[ResumableAgentController] Creating job`, {
      streamId,
      conversationId,
      reqConversationId,
      userId,
    });

    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);
    const jobCreatedAt = job.createdAt; // Capture creation time to detect job replacement
    req._resumableStreamId = streamId;
    getMCPRequestContext(req, undefined, { cleanupOnResponse: false });

    // Send JSON response IMMEDIATELY so client can connect to SSE stream
    // This is critical: tool loading (MCP OAuth) may emit events that the client needs to receive
    res.json({ streamId, conversationId, status: 'started' });

    await attachConversationCreatedAt(req, { userId, conversationId, isNewConvo });

    const endpointIconURL = getEndpointIconURL(req, endpointOption);
    const responseModel = getAgentResponseModel(req, endpointOption);
    const preliminaryUserMessage = getPreliminaryUserMessage(req.body, conversationId);
    const preliminaryResponseMessageId = getPreliminaryResponseMessageId(req.body);
    await GenerationJobManager.updateMetadata(streamId, {
      conversationId,
      endpoint: endpointOption.endpoint,
      iconURL: endpointIconURL,
      model: responseModel,
      responseMessageId: preliminaryResponseMessageId,
      userMessage: preliminaryUserMessage,
      // A DR run persists its own terminal message on a Stop, so the generic abort must not
      // synthesise a final from the job buffer — DR streams no tokens outside the report, so
      // that final would be EMPTY, and the client takes the FIRST final as THE final. Claimed
      // in this first metadata write (not inside the run, which is several awaits further on)
      // so a Stop can't land in between and still get the empty one.
      producerFinalizesOnAbort: useNewDeepResearch,
    });

    // Note: We no longer use res.on('close') to abort since we send JSON immediately.
    // The response closes normally after res.json(), which is not an abort condition.
    // Abort handling is done through GenerationJobManager via the SSE stream connection.

    // Track if partial response was already saved to avoid duplicates
    let partialResponseSaved = false;

    /**
     * Listen for all subscribers leaving to save partial response.
     * This ensures the response is saved to DB even if all clients disconnect
     * while generation continues.
     *
     * Note: The messageId used here falls back to `${userMessage.messageId}_` if the
     * actual response messageId isn't available yet. The final response save will
     * overwrite this with the complete response using the same messageId pattern.
     */
    job.emitter.on('allSubscribersLeft', async (aggregatedContent) => {
      if (partialResponseSaved || !aggregatedContent || aggregatedContent.length === 0) {
        return;
      }

      const persistableContent = filterPersistableAbortContent(aggregatedContent);
      if (persistableContent.length === 0) {
        logger.debug('[ResumableAgentController] No persistable content to save partial response');
        return;
      }

      const resumeState = await GenerationJobManager.getResumeState(streamId);
      if (!resumeState?.userMessage) {
        logger.debug('[ResumableAgentController] No user message to save partial response for');
        return;
      }

      partialResponseSaved = true;
      const responseConversationId = resumeState.conversationId || conversationId;

      try {
        const partialMessage = {
          messageId: resumeState.responseMessageId || `${resumeState.userMessage.messageId}_`,
          conversationId: responseConversationId,
          parentMessageId: resumeState.userMessage.messageId,
          sender: client?.sender ?? 'AI',
          content: persistableContent,
          unfinished: true,
          error: false,
          isCreatedByUser: false,
          user: userId,
          endpoint: endpointOption.endpoint,
          iconURL: resumeState.iconURL || endpointIconURL,
          model: resumeState.model || responseModel,
        };

        if (req.body?.agent_id) {
          partialMessage.agent_id = req.body.agent_id;
        }

        await saveMessage(
          {
            userId: req?.user?.id,
            isTemporary: req?.body?.isTemporary,
            interfaceConfig: req?.config?.interfaceConfig,
          },
          partialMessage,
          { context: 'api/server/controllers/agents/request.js - partial response on disconnect' },
        );

        logger.debug(
          `[ResumableAgentController] Saved partial response for ${streamId}, content parts: ${persistableContent.length}`,
        );
      } catch (error) {
        logger.error('[ResumableAgentController] Error saving partial response:', error);
        // Reset flag so we can try again if subscribers reconnect and leave again
        partialResponseSaved = false;
      }
    });

    /** Task #21 (review r2): classify the DR turn ONCE, before the heavy client init.
     *  A plan-cancel makes zero model calls and must not pay agent/tool initialization —
     *  «Исследование отменено.» renders near-instantly. Every other DR turn still
     *  initializes the client below and passes this classification through (the runner
     *  then skips its own conversation load). */
    let drTurn = null;
    if (useNewDeepResearch) {
      if (req.body?.ephemeralAgent?.deep_research !== true) {
        logger.info(
          '[AgentController] DR follow-up detected — routing to Deep Research (badge was off)',
        );
      }
      drTurn = await buildDrTurnContext({
        userId,
        conversationId,
        parentMessageId,
        text,
        currentUserMessageId: preliminaryUserMessage?.messageId,
      });
      if (drTurn.kind === 'plan-cancel') {
        try {
          await runNewDeepResearch({
            req,
            res,
            streamId,
            signal: job.abortController.signal,
            endpoint: endpointOption.endpoint,
            conversationModel: endpointOption.model_parameters?.model,
            userId,
            conversationId,
            parentMessageId,
            responseMessageId: preliminaryResponseMessageId,
            userMessage: preliminaryUserMessage,
            text,
            turn: drTurn,
            jobCreatedAt,
          });
        } finally {
          await finishResumableRequest(req, userId);
        }
        return;
      }
    }

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      // Use the job's abort controller signal - allows abort via GenerationJobManager.abortJob()
      signal: job.abortController.signal,
    });

    if (job.abortController.signal.aborted) {
      GenerationJobManager.completeJob(streamId, 'Request aborted during initialization');
      await finishResumableRequest(req, userId);
      return;
    }

    client = result.client;

    /** New StateGraph Deep Research engine, behind `deepResearch.useNewEngine`.
     *  Runs the custom graph INSTEAD of the standard agent run and returns early.
     *  The legacy DR is the default (flag off), so this branch cannot regress it.
     *  Routing (hoisted above createJob, review r2) is badge OR DR-follow-up: a reply to
     *  a clarify prompt or a plan card (start/edit, task #21) continues into DR even when
     *  the frontend flag was lost — otherwise the reply lands in normal chat and a plain
     *  model improvises a source-less "report" (live-observed failure). */
    if (useNewDeepResearch) {
      /**
       * Deep Research runs synchronously in this request and emits `dr_progress`, not token
       * chunks. That progress does reach `recordActivity`, but in Redis (prod) that is a
       * no-op and the reaper judges a running job purely by age, so a run killed by a
       * container restart looks "running" until the 20-minute failsafe. A timer beats a real
       * liveness timestamp onto the job instead; the reaper reaps a job whose heartbeat has
       * stopped and tells the reconnected client, so it unsticks in ~1–2 min. Beat once up
       * front so the job carries a heartbeat from t=0, and `unref` so it never holds the
       * event loop open. The `finally` clears it — no beat can outlive the run.
       */
      GenerationJobManager.recordHeartbeat(streamId).catch(() => {});
      const heartbeat = setInterval(() => {
        GenerationJobManager.recordHeartbeat(streamId).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
      if (typeof heartbeat.unref === 'function') {
        heartbeat.unref();
      }
      try {
        await runNewDeepResearch({
          req,
          res,
          streamId,
          signal: job.abortController.signal,
          endpoint: client?.options?.agent?.endpoint ?? endpointOption.endpoint,
          conversationModel:
            client?.options?.agent?.model ?? endpointOption.model_parameters?.model,
          userId,
          conversationId,
          parentMessageId,
          responseMessageId: preliminaryResponseMessageId,
          sender: client?.sender,
          userMessage: preliminaryUserMessage,
          text,
          turn: drTurn,
          jobCreatedAt,
        });
      } finally {
        clearInterval(heartbeat);
        // H3: this branch returns early and runs the whole DR synchronously, so the
        // normal background-completion cleanup never fires for it. Release the pending-
        // request slot and dispose the heavy agent client here. Nulling `client` stops
        // the outer catch from disposing it a second time if the run threw.
        await finishResumableRequest(req, userId);
        if (client) {
          disposeClient(client);
          client = null;
        }
      }
      return;
    }

    // Resolve title timing from the public agents endpoint first, then fall
    // back to the agent's actual backing provider/custom endpoint.
    titleTiming = resolveTitleTiming({
      appConfig: req.config,
      endpoint: [endpointOption?.endpoint, client?.options?.agent?.endpoint],
    });

    if (client?.sender) {
      GenerationJobManager.updateMetadata(streamId, { sender: client.sender });
    }

    // Store reference to client's contentParts - graph will be set when run is created
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    let userMessage;

    const getReqData = (data = {}) => {
      if (data.userMessage) {
        userMessage = data.userMessage;
      }
      // conversationId is pre-generated, no need to update from callback
    };

    // Start background generation - readyPromise resolves immediately now
    // (sync mechanism handles late subscribers)
    const startGeneration = async () => {
      try {
        // Short timeout as safety net - promise should already be resolved
        await Promise.race([job.readyPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
      } catch (waitError) {
        logger.warn(
          `[ResumableAgentController] Error waiting for subscriber: ${waitError.message}`,
        );
      }

      /** Immediate-mode title generation runs in parallel with the response, so
       *  the conversation row may not exist when the title resolves. `convoReady`
       *  resolves once the response (and thus the conversation) has been saved,
       *  gating the title's `saveConvo`. Declared here so both the success tail
       *  and the catch block can settle it and gate `disposeClient` on the title. */
      let immediateTitlePromise = null;
      let titleEventPromise = null;
      let acceptsTitleEvents = true;
      let resolveConvoReady;
      const convoReady = new Promise((resolve) => {
        resolveConvoReady = resolve;
      });
      /** Dedicated controller so a user Stop (or a replaced stream) cancels the
       *  in-flight title — kept separate from `job.abortController`, which
       *  `completeJob` also aborts on *successful* completion and would otherwise
       *  cancel a title that is merely slower than a short response. */
      const titleAbortController = new AbortController();
      /** Separate from `titleAbortController`: a user Stop cancels the in-flight
       *  title model call but keeps a title that already finished generating.
       *  Only a superseded/failed stream aborts this to discard such a title so it
       *  cannot clobber the conversation now owned by the newer run. */
      const titleDiscardController = new AbortController();
      const abortTitleOnJobAbort = () => titleAbortController.abort();
      if (job.abortController.signal.aborted) {
        titleAbortController.abort();
      } else {
        job.abortController.signal.addEventListener('abort', abortTitleOnJobAbort, { once: true });
      }
      const titleEligible =
        addTitle && parentMessageId === Constants.NO_PARENT && isNewConvo && !req.body?.isTemporary;
      const emitTitleEvent = ({ conversationId: titleConversationId, title }) => {
        titleEventPromise = (async () => {
          if (!acceptsTitleEvents || titleAbortController.signal.aborted) {
            return;
          }
          const currentJob = await GenerationJobManager.getJob(streamId);
          if (!currentJob || currentJob.createdAt !== jobCreatedAt) {
            return;
          }
          if (titleAbortController.signal.aborted) {
            return;
          }
          await GenerationJobManager.emitChunk(streamId, {
            event: 'title',
            data: {
              conversationId: titleConversationId,
              title,
            },
          });
        })().catch((err) => {
          logger.error('[ResumableAgentController] Error emitting title event', err);
        });
        return titleEventPromise;
      };

      try {
        const onStart = (userMsg, respMsgId, _isNewConvo) => {
          userMessage = userMsg;

          // Store userMessage and responseMessageId upfront for resume capability
          GenerationJobManager.updateMetadata(streamId, {
            responseMessageId: respMsgId,
            userMessage: {
              messageId: userMsg.messageId,
              parentMessageId: userMsg.parentMessageId,
              conversationId: userMsg.conversationId,
              text: userMsg.text,
              sender: userMsg.sender,
              isCreatedByUser: userMsg.isCreatedByUser,
            },
          });

          GenerationJobManager.emitChunk(streamId, {
            created: true,
            message: userMessage,
            streamId,
          });
        };

        const messageOptions = {
          user: userId,
          onStart,
          getReqData,
          isContinued,
          isRegenerate,
          editedContent,
          conversationId,
          parentMessageId,
          abortController: job.abortController,
          overrideParentMessageId,
          isEdited: !!editedContent,
          userMCPAuthMap: result.userMCPAuthMap,
          responseMessageId: editedResponseMessageId,
          progressOptions: {
            res: {
              write: () => true,
              end: () => {},
              headersSent: false,
              writableEnded: false,
            },
          },
        };

        const sendPromise = client.sendMessage(text, messageOptions);

        if (titleEligible && titleTiming === 'immediate') {
          immediateTitlePromise = addTitle(req, {
            text,
            conversationId,
            client,
            immediate: true,
            convoReady,
            signal: titleAbortController.signal,
            discardSignal: titleDiscardController.signal,
            onTitleGenerated: emitTitleEvent,
          }).catch((err) => {
            logger.error('[ResumableAgentController] Error in immediate title generation', err);
          });
        }

        const response = await sendPromise;

        const messageId = response.messageId;
        const endpoint = endpointOption.endpoint;
        response.endpoint = endpoint;

        const databasePromise = response.databasePromise;
        delete response.databasePromise;

        const { conversation: convoData = {} } = await databasePromise;
        const conversation = { ...convoData };
        conversation.title =
          conversation && !conversation.title ? null : conversation?.title || 'New Chat';

        if (req.body.files && Array.isArray(client.options.attachments)) {
          const files = buildMessageFiles(req.body.files, client.options.attachments);
          if (files.length > 0) {
            userMessage.files = files;
          }
          delete userMessage.image_urls;
        }

        // Check abort state BEFORE calling completeJob (which triggers abort signal for cleanup)
        const wasAbortedBeforeComplete = job.abortController.signal.aborted;
        const shouldGenerateTitle =
          addTitle &&
          parentMessageId === Constants.NO_PARENT &&
          isNewConvo &&
          !wasAbortedBeforeComplete;

        // Save user message BEFORE sending final event to avoid race condition
        // where client refetch happens before database is updated
        const reqCtx = {
          userId: req?.user?.id,
          isTemporary: req?.body?.isTemporary,
          interfaceConfig: req?.config?.interfaceConfig,
        };

        if (!client.skipSaveUserMessage && userMessage) {
          await saveMessage(reqCtx, userMessage, {
            context: 'api/server/controllers/agents/request.js - resumable user message',
          });
        }

        // CRITICAL: Save response message BEFORE emitting final event.
        // This prevents race conditions where the client sends a follow-up message
        // before the response is saved to the database, causing orphaned parentMessageIds.
        if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
          await saveMessage(
            reqCtx,
            { ...response, user: userId, unfinished: wasAbortedBeforeComplete },
            { context: 'api/server/controllers/agents/request.js - resumable response end' },
          );
        }

        // Check if our job was replaced by a new request before emitting
        // This prevents stale requests from emitting events to newer jobs
        const currentJob = await GenerationJobManager.getJob(streamId);
        const jobWasReplaced = !currentJob || currentJob.createdAt !== jobCreatedAt;

        if (jobWasReplaced) {
          logger.debug(`[ResumableAgentController] Skipping FINAL emit - job was replaced`, {
            streamId,
            originalCreatedAt: jobCreatedAt,
            currentCreatedAt: currentJob?.createdAt,
          });
          // Discard the stale title from this replaced stream: cancel it and
          // unblock its persistence wait without letting it save (the newer job
          // owns the conversation now).
          titleAbortController.abort();
          titleDiscardController.abort();
          job.abortController.signal.removeEventListener('abort', abortTitleOnJobAbort);
          acceptsTitleEvents = false;
          resolveConvoReady();
          // Still decrement pending request since we incremented at start
          await finishResumableRequest(req, userId);
          if (immediateTitlePromise) {
            immediateTitlePromise.finally(() => {
              if (client) {
                disposeClient(client);
              }
            });
          } else if (client) {
            disposeClient(client);
          }
          return;
        }

        // If the user stopped this turn, cancel the title BEFORE unblocking its
        // persistence wait — otherwise resolving `convoReady` lets the title task
        // resume and save before the later abort runs.
        if (wasAbortedBeforeComplete) {
          titleAbortController.abort();
        } else {
          job.abortController.signal.removeEventListener('abort', abortTitleOnJobAbort);
        }

        // The conversation row now exists and this stream is authoritative; allow
        // any in-flight immediate title generation to persist (saveConvo uses noUpsert).
        resolveConvoReady();

        // Recover a lost title before the stream closes. In immediate mode a slow
        // document turn can blow the title's 45s timeout (the agent run is not ready
        // in time), leaving the conversation as "New Chat"; the frontend's genTitle
        // poll has already given up, so a title saved later would not surface without
        // a reload. Only when this turn COMPLETED successfully — a stopped or
        // superseded turn intentionally discards its title via `titleDiscardController`
        // — and the immediate attempt produced nothing, regenerate from the finished
        // response and push it through the title event while the client is still
        // subscribed (before `acceptsTitleEvents` is cleared below).
        if (titleEligible && !wasAbortedBeforeComplete && immediateTitlePromise) {
          const immediateTitle = await immediateTitlePromise;
          if (!immediateTitle) {
            try {
              const fallbackTitle = await addTitle(req, {
                text,
                response: { ...response },
                client,
                conversationId: conversation.conversationId,
                onTitleGenerated: emitTitleEvent,
              });
              if (fallbackTitle) {
                conversation.title = fallbackTitle;
              }
            } catch (err) {
              logger.error('[ResumableAgentController] Fallback title generation failed', err);
            }
          }
        }

        acceptsTitleEvents = false;

        if (titleEventPromise) {
          await titleEventPromise;
        }

        if (!wasAbortedBeforeComplete) {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response },
          };

          logger.debug(`[ResumableAgentController] Emitting FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId);
          await finishResumableRequest(req, userId);
        } else {
          const finalEvent = {
            final: true,
            conversation,
            title: conversation.title,
            requestMessage: sanitizeMessageForTransmit(userMessage),
            responseMessage: { ...response, unfinished: true },
          };

          logger.debug(`[ResumableAgentController] Emitting ABORTED FINAL event`, {
            streamId,
            wasAbortedBeforeComplete,
            userMessageId: userMessage?.messageId,
            responseMessageId: response?.messageId,
            conversationId: conversation?.conversationId,
          });

          await GenerationJobManager.emitDone(streamId, finalEvent);
          GenerationJobManager.completeJob(streamId, 'Request aborted');
          await finishResumableRequest(req, userId);
        }

        if (titleTiming === 'immediate') {
          // Title was fired in parallel above (if eligible); a stopped turn already
          // aborted it before `resolveConvoReady`. Defer disposal until it settles
          // so the run/req aren't torn down mid-generation.
          if (immediateTitlePromise) {
            immediateTitlePromise.finally(() => {
              if (client) {
                disposeClient(client);
              }
            });
          } else if (client) {
            disposeClient(client);
          }
        } else if (shouldGenerateTitle) {
          addTitle(req, {
            text,
            response: { ...response },
            client,
          })
            .catch((err) => {
              logger.error('[ResumableAgentController] Error in title generation', err);
            })
            .finally(() => {
              if (client) {
                disposeClient(client);
              }
            });
        } else {
          if (client) {
            disposeClient(client);
          }
        }
      } catch (error) {
        // Any failure (user Stop, or a preflight/quota failure before the run is
        // even created) must cancel the title and unblock its waits: the title's
        // `_waitForRun` would otherwise never resolve, deferring client disposal
        // until the 45s title timeout, and no title should persist for a failed turn.
        titleAbortController.abort();
        titleDiscardController.abort();
        job.abortController.signal.removeEventListener('abort', abortTitleOnJobAbort);
        acceptsTitleEvents = false;
        resolveConvoReady();

        // Check if this was an abort (not a real error)
        const wasAborted = job.abortController.signal.aborted || error.message?.includes('abort');

        if (wasAborted) {
          logger.debug(`[ResumableAgentController] Generation aborted for ${streamId}`);
          // abortJob already handled emitDone and completeJob — which holds only for producers
          // that let it finalize. One that sets `producerFinalizesOnAbort` owns its own final,
          // and staying silent here would hang its client. Deep Research is the only such
          // producer and never reaches this path (it returns before `startGeneration` runs),
          // so this stays correct — but a second one would have to be handled here.
        } else {
          logger.error(`[ResumableAgentController] Generation error for ${streamId}:`, error);
          await GenerationJobManager.emitError(streamId, error.message || 'Generation failed');
          GenerationJobManager.completeJob(streamId, error.message);
        }

        await finishResumableRequest(req, userId);

        // Defer disposal until any immediate title settles (it holds the run/req).
        if (immediateTitlePromise) {
          immediateTitlePromise.finally(() => {
            if (client) {
              disposeClient(client);
            }
          });
        } else if (client) {
          disposeClient(client);
        }

        // Don't continue to title generation after error/abort
        return;
      }
    };

    // Start generation and handle any unhandled errors
    startGeneration().catch(async (err) => {
      logger.error(
        `[ResumableAgentController] Unhandled error in background generation: ${err.message}`,
      );
      GenerationJobManager.completeJob(streamId, err.message);
      await finishResumableRequest(req, userId);
    });
  } catch (error) {
    logger.error('[ResumableAgentController] Initialization error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to start generation' });
    } else {
      // JSON already sent, emit error to stream so client can receive it
      await GenerationJobManager.emitError(streamId, error.message || 'Failed to start generation');
    }
    GenerationJobManager.completeJob(streamId, error.message);
    await finishResumableRequest(req, userId);
    if (client) {
      disposeClient(client);
    }
  }
};

/**
 * Agent Controller - Routes to ResumableAgentController for all requests.
 * The legacy non-resumable path is kept below but no longer used by default.
 */
const AgentController = async (req, res, next, initializeClient, addTitle) => {
  return ResumableAgentController(req, res, next, initializeClient, addTitle);
};

/**
 * Legacy Non-resumable Agent Controller - Uses GenerationJobManager for abort handling.
 * Response is streamed directly to client via res, but abort state is managed centrally.
 * @deprecated Use ResumableAgentController instead
 */
const _LegacyAgentController = async (req, res, next, initializeClient, addTitle) => {
  const {
    text,
    isRegenerate,
    endpointOption,
    conversationId: reqConversationId,
    isContinued = false,
    editedContent = null,
    parentMessageId = null,
    overrideParentMessageId = null,
    responseMessageId: editedResponseMessageId = null,
  } = req.body;

  // Generate conversationId upfront if not provided - streamId === conversationId always
  // Treat "new" as a placeholder that needs a real UUID (frontend may send "new" for new convos)
  const isNewConvo = !reqConversationId || reqConversationId === 'new';
  const conversationId = isNewConvo ? crypto.randomUUID() : reqConversationId;
  const streamId = conversationId;

  let userMessage;
  let userMessageId;
  let responseMessageId;
  let client = null;
  let cleanupHandlers = [];

  // Match the same logic used for conversationId generation above
  const userId = req.user.id;

  if (
    await isUnpersistedPreliminaryParent({
      userId,
      conversationId: reqConversationId,
      parentMessageId,
      getMessages,
    })
  ) {
    return rejectPreliminaryParentMessageId(res);
  }

  await attachConversationCreatedAt(req, { userId, conversationId, isNewConvo });

  // Create handler to avoid capturing the entire parent scope
  let getReqData = (data = {}) => {
    for (let key in data) {
      if (key === 'userMessage') {
        userMessage = data[key];
        userMessageId = data[key].messageId;
      } else if (key === 'responseMessageId') {
        responseMessageId = data[key];
      } else if (key === 'promptTokens') {
        // Update job metadata with prompt tokens for abort handling
        GenerationJobManager.updateMetadata(streamId, { promptTokens: data[key] });
      } else if (key === 'sender') {
        GenerationJobManager.updateMetadata(streamId, { sender: data[key] });
      }
      // conversationId is pre-generated, no need to update from callback
    }
  };

  // Create a function to handle final cleanup
  const performCleanup = async () => {
    logger.debug('[AgentController] Performing cleanup');
    if (Array.isArray(cleanupHandlers)) {
      for (const handler of cleanupHandlers) {
        try {
          if (typeof handler === 'function') {
            handler();
          }
        } catch (e) {
          logger.error('[AgentController] Error in cleanup handler', e);
        }
      }
    }

    // Complete the job in GenerationJobManager
    if (streamId) {
      logger.debug('[AgentController] Completing job in GenerationJobManager');
      await GenerationJobManager.completeJob(streamId);
    }

    // Dispose client properly
    if (client) {
      disposeClient(client);
    }

    // Clear all references
    client = null;
    getReqData = null;
    userMessage = null;
    cleanupHandlers = null;

    // Clear request data map
    if (requestDataMap.has(req)) {
      requestDataMap.delete(req);
    }
    logger.debug('[AgentController] Cleanup completed');
  };

  try {
    let prelimAbortController = new AbortController();
    const prelimCloseHandler = createCloseHandler(prelimAbortController);
    res.on('close', prelimCloseHandler);
    const removePrelimHandler = (manual) => {
      try {
        prelimCloseHandler(manual);
        res.removeListener('close', prelimCloseHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    };
    cleanupHandlers.push(removePrelimHandler);

    /** @type {{ client: TAgentClient; userMCPAuthMap?: Record<string, Record<string, string>> }} */
    const result = await initializeClient({
      req,
      res,
      endpointOption,
      signal: prelimAbortController.signal,
    });

    if (prelimAbortController.signal?.aborted) {
      prelimAbortController = null;
      throw new Error('Request was aborted before initialization could complete');
    } else {
      prelimAbortController = null;
      removePrelimHandler(true);
      cleanupHandlers.pop();
    }
    client = result.client;

    // Register client with finalization registry if available
    if (clientRegistry) {
      clientRegistry.register(client, { userId }, client);
    }

    // Store request data in WeakMap keyed by req object
    requestDataMap.set(req, { client });

    // Create job in GenerationJobManager for abort handling
    // streamId === conversationId (pre-generated above)
    const job = await GenerationJobManager.createJob(streamId, userId, conversationId);

    // Store endpoint metadata for abort handling
    GenerationJobManager.updateMetadata(streamId, {
      endpoint: endpointOption.endpoint,
      iconURL: getEndpointIconURL(req, endpointOption),
      model: getAgentResponseModel(req, endpointOption),
      sender: client?.sender,
    });

    // Store content parts reference for abort
    if (client?.contentParts) {
      GenerationJobManager.setContentParts(streamId, client.contentParts);
    }

    const closeHandler = createCloseHandler(job.abortController);
    res.on('close', closeHandler);
    cleanupHandlers.push(() => {
      try {
        res.removeListener('close', closeHandler);
      } catch (e) {
        logger.error('[AgentController] Error removing close listener', e);
      }
    });

    /**
     * onStart callback - stores user message and response ID for abort handling
     */
    const onStart = (userMsg, respMsgId, _isNewConvo) => {
      sendEvent(res, { message: userMsg, created: true });
      userMessage = userMsg;
      userMessageId = userMsg.messageId;
      responseMessageId = respMsgId;

      // Store metadata for abort handling (conversationId is pre-generated)
      GenerationJobManager.updateMetadata(streamId, {
        responseMessageId: respMsgId,
        userMessage: {
          messageId: userMsg.messageId,
          parentMessageId: userMsg.parentMessageId,
          conversationId,
          text: userMsg.text,
          sender: userMsg.sender,
          isCreatedByUser: userMsg.isCreatedByUser,
        },
      });
    };

    const messageOptions = {
      user: userId,
      onStart,
      getReqData,
      isContinued,
      isRegenerate,
      editedContent,
      conversationId,
      parentMessageId,
      abortController: job.abortController,
      overrideParentMessageId,
      isEdited: !!editedContent,
      userMCPAuthMap: result.userMCPAuthMap,
      responseMessageId: editedResponseMessageId,
      progressOptions: {
        res,
      },
    };

    let response = await client.sendMessage(text, messageOptions);

    // Extract what we need and immediately break reference
    const messageId = response.messageId;
    const endpoint = endpointOption.endpoint;
    response.endpoint = endpoint;

    // Store database promise locally
    const databasePromise = response.databasePromise;
    delete response.databasePromise;

    // Resolve database-related data
    const { conversation: convoData = {} } = await databasePromise;
    const conversation = { ...convoData };
    conversation.title =
      conversation && !conversation.title ? null : conversation?.title || 'New Chat';

    if (req.body.files && Array.isArray(client.options.attachments)) {
      const files = buildMessageFiles(req.body.files, client.options.attachments);
      if (files.length > 0) {
        userMessage.files = files;
      }
      delete userMessage.image_urls;
    }

    // Only send if not aborted
    if (!job.abortController.signal.aborted) {
      // Create a new response object with minimal copies
      const finalResponse = { ...response };

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
      });
      res.end();

      // Save the message if needed
      if (client.savedMessageIds && !client.savedMessageIds.has(messageId)) {
        await saveMessage(
          {
            userId: req?.user?.id,
            isTemporary: req?.body?.isTemporary,
            interfaceConfig: req?.config?.interfaceConfig,
          },
          { ...finalResponse, user: userId },
          { context: 'api/server/controllers/agents/request.js - response end' },
        );
      }
    }
    // Edge case: sendMessage completed but abort happened during sendCompletion
    // We need to ensure a final event is sent
    else if (!res.headersSent && !res.finished) {
      logger.debug(
        '[AgentController] Handling edge case: `sendMessage` completed but aborted during `sendCompletion`',
      );

      const finalResponse = { ...response };
      finalResponse.error = true;

      sendEvent(res, {
        final: true,
        conversation,
        title: conversation.title,
        requestMessage: sanitizeMessageForTransmit(userMessage),
        responseMessage: finalResponse,
        error: { message: 'Request was aborted during completion' },
      });
      res.end();
    }

    // Save user message if needed
    if (!client.skipSaveUserMessage) {
      await saveMessage(
        {
          userId: req?.user?.id,
          isTemporary: req?.body?.isTemporary,
          interfaceConfig: req?.config?.interfaceConfig,
        },
        userMessage,
        { context: "api/server/controllers/agents/request.js - don't skip saving user message" },
      );
    }

    // Add title if needed - extract minimal data
    if (addTitle && parentMessageId === Constants.NO_PARENT && isNewConvo) {
      addTitle(req, {
        text,
        response: { ...response },
        client,
      })
        .then(() => {
          logger.debug('[AgentController] Title generation started');
        })
        .catch((err) => {
          logger.error('[AgentController] Error in title generation', err);
        })
        .finally(() => {
          logger.debug('[AgentController] Title generation completed');
          performCleanup();
        });
    } else {
      performCleanup();
    }
  } catch (error) {
    // Handle error without capturing much scope
    handleAbortError(res, req, error, {
      conversationId,
      sender: client?.sender,
      messageId: responseMessageId,
      parentMessageId: overrideParentMessageId ?? userMessageId ?? parentMessageId,
      userMessageId,
    })
      .catch((err) => {
        logger.error('[api/server/controllers/agents/request] Error in `handleAbortError`', err);
      })
      .finally(() => {
        performCleanup();
      });
  }
};

module.exports = AgentController;
/** Test-only export: the regenerate/user-message shape has live-bug history (see JSDoc). */
module.exports.getPreliminaryUserMessage = getPreliminaryUserMessage;
