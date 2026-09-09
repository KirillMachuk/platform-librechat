const { PermissionTypes, Permissions } = require('librechat-data-provider');

const mockIsDrFollowUp = jest.fn();
jest.mock('~/server/services/Endpoints/agents/deepResearchRun', () => ({
  runNewDeepResearch: jest.fn(),
  buildDrTurnContext: jest.fn(),
  isDrFollowUp: (...args) => mockIsDrFollowUp(...args),
}));

/** `request.js` destructures these at module load, so the module object has to be
 *  replaced before it is required — a `jest.spyOn` on `~/models` would come too late
 *  and the real `getRoleByName` would run against a database that isn't there.
 *  `checkAccess` itself stays real; only the role document is controlled. */
const mockGetRoleByName = jest.fn();
jest.mock('~/models', () => ({
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  getConvo: jest.fn(),
  getRoleByName: (...args) => mockGetRoleByName(...args),
}));

const {
  getPreliminaryUserMessage,
  shouldRunNewDeepResearch,
  drConversationModel,
  pickFinalTitle,
  hasRealTitle,
  isSupersededByNewerJob,
  shouldSkipFinalEmit,
  settleTitleForEndedJob,
} = require('./request');

describe('getPreliminaryUserMessage (DR turn shape)', () => {
  const conversationId = 'convo-1';

  it('builds the user message from body ids on a fresh turn', () => {
    const message = getPreliminaryUserMessage(
      { messageId: 'u-new', parentMessageId: 'p-0', text: 'вопрос' },
      conversationId,
    );
    expect(message).toEqual({
      messageId: 'u-new',
      parentMessageId: 'p-0',
      conversationId,
      text: 'вопрос',
      sender: 'User',
      isCreatedByUser: true,
    });
  });

  it('REGENERATE reuses the EXISTING user message id (overrideParentMessageId), not the placeholder', () => {
    // Stock client (useChatFunctions): on regenerate body.messageId is a fresh v4
    // placeholder while overrideParentMessageId carries the original user message id.
    // Building from the placeholder saved a duplicate user sibling (live bug: user
    // bubble "disappeared" behind a 2/2 switcher after regenerating a plan card).
    const message = getPreliminaryUserMessage(
      {
        messageId: 'placeholder-v4',
        parentMessageId: 'p-0',
        text: 'вопрос',
        isRegenerate: true,
        overrideParentMessageId: 'u-original',
      },
      conversationId,
    );
    expect(message?.messageId).toBe('u-original');
    expect(message?.parentMessageId).toBe('p-0');
  });

  it('REGENERATE falls back to body.messageId when override is absent (defensive)', () => {
    const message = getPreliminaryUserMessage(
      { messageId: 'u-x', parentMessageId: 'p-0', text: 't', isRegenerate: true },
      conversationId,
    );
    expect(message?.messageId).toBe('u-x');
  });

  it('returns null without a usable id', () => {
    expect(getPreliminaryUserMessage({ text: 't' }, conversationId)).toBeNull();
    expect(getPreliminaryUserMessage({ messageId: '' }, conversationId)).toBeNull();
  });
});

/**
 * This is the routing gate for the engine that actually runs in production
 * (`deepResearch.useNewEngine: true`). `initializeClient`'s `deepResearchActive` feeds
 * only the legacy engine, so a permission gate that lives solely there is a no-op here
 * — hence these assert the real path.
 */
describe('shouldRunNewDeepResearch — routing + RBAC', () => {
  const ROUTE = { userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' };

  /** Controls only the role document the real `checkAccess` reads.
   *  canUseDeepResearch requires BOTH WEB_SEARCH.USE and DEEP_RESEARCH.USE,
   *  so the helper grants/denies them together. */
  const setWebSearchPermission = (allowed) =>
    mockGetRoleByName.mockResolvedValue({
      permissions: {
        [PermissionTypes.WEB_SEARCH]: { [Permissions.USE]: allowed },
        [PermissionTypes.DEEP_RESEARCH]: { [Permissions.USE]: allowed },
      },
    });

  const makeReq = ({ badge = true, useNewEngine = true } = {}) => ({
    user: { id: 'u1', role: 'USER' },
    config: { deepResearch: { useNewEngine } },
    body: { ephemeralAgent: badge ? { deep_research: true } : {} },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDrFollowUp.mockResolvedValue(false);
  });

  it('routes into research when the badge is on and the role holds the permission', async () => {
    setWebSearchPermission(true);
    await expect(shouldRunNewDeepResearch({ req: makeReq(), ...ROUTE })).resolves.toBe(true);
  });

  it('refuses the badge when the role lacks the permission', async () => {
    setWebSearchPermission(false);
    await expect(shouldRunNewDeepResearch({ req: makeReq(), ...ROUTE })).resolves.toBe(false);
  });

  it('refuses a DR follow-up (badge off) when the role lacks the permission', async () => {
    setWebSearchPermission(false);
    mockIsDrFollowUp.mockResolvedValue(true);
    await expect(
      shouldRunNewDeepResearch({ req: makeReq({ badge: false }), ...ROUTE }),
    ).resolves.toBe(false);
  });

  it('still routes a DR follow-up (badge off) when the role holds the permission', async () => {
    setWebSearchPermission(true);
    mockIsDrFollowUp.mockResolvedValue(true);
    await expect(
      shouldRunNewDeepResearch({ req: makeReq({ badge: false }), ...ROUTE }),
    ).resolves.toBe(true);
  });

  it('fails closed when the permission lookup throws', async () => {
    mockGetRoleByName.mockRejectedValue(new Error('mongo unreachable'));
    await expect(shouldRunNewDeepResearch({ req: makeReq(), ...ROUTE })).resolves.toBe(false);
  });

  it('costs an ordinary chat turn nothing: no follow-up query, no role lookup', async () => {
    const roleLookup = setWebSearchPermission(true);
    await expect(
      shouldRunNewDeepResearch({ req: makeReq({ badge: false }), ...ROUTE }),
    ).resolves.toBe(false);
    expect(roleLookup).not.toHaveBeenCalled();
  });

  it('leaves the legacy engine alone and never consults the role', async () => {
    const roleLookup = setWebSearchPermission(true);
    await expect(
      shouldRunNewDeepResearch({ req: makeReq({ useNewEngine: false }), ...ROUTE }),
    ).resolves.toBe(false);
    expect(mockIsDrFollowUp).not.toHaveBeenCalled();
    expect(roleLookup).not.toHaveBeenCalled();
  });
});

/**
 * The consumer end of a hop that crosses three files: initialize.js captures the
 * conversation's model before overwriting the agent with the tier's lead, carries it on the
 * client options, and this is where the Deep Research runner reads it. The producer half had
 * a test; this half did not, and deleting the line that reads it left the entire backend
 * suite green.
 */
describe('drConversationModel', () => {
  it('prefers the captured conversation model over the overwritten agent model', () => {
    const client = {
      options: {
        deepResearchConversationModel: 'gpt-4',
        agent: { model: 'lead-x' },
      },
    };
    expect(drConversationModel(client, { model_parameters: { model: 'body-model' } })).toBe(
      'gpt-4',
    );
  });

  it('falls back to the agent model when nothing was captured', () => {
    const client = { options: { agent: { model: 'lead-x' } } };
    expect(drConversationModel(client, { model_parameters: { model: 'body-model' } })).toBe(
      'lead-x',
    );
  });

  it('falls back to the request body when there is no client at all', () => {
    expect(drConversationModel(undefined, { model_parameters: { model: 'body-model' } })).toBe(
      'body-model',
    );
  });

  it('returns undefined rather than throwing when nothing is available', () => {
    expect(drConversationModel(undefined, undefined)).toBeUndefined();
  });
});

/* The chat titles the owner has been chasing for months.
 *
 * In immediate mode the title is generated in parallel with the answer and persisted
 * only after `convoReady`, which resolves AFTER the conversation row behind the final
 * event was read. So the row carries «New Chat» and the controller sent that to a
 * client the `title` event had already given the real title — right, then wrong, then
 * right again when the compensating `/gen_title` poll landed.
 *
 * The value used here is what `addTitle` RETURNED, i.e. the title it just persisted.
 * The first attempt at this fix read the GEN_TITLE cache instead and would have fired
 * exactly never: that entry lives two minutes, and the three runs it was written for
 * took 266s, 306s and 404s between the title and the final event. A returned value has
 * no clock on it. */
describe('pickFinalTitle — the title the FINAL event carries', () => {
  it('uses the generated title when the row has not caught up yet', () => {
    expect(
      pickFinalTitle({ rowTitle: 'New Chat', generatedTitle: 'Презентация погоды в Минске' }),
    ).toBe('Презентация погоды в Минске');
  });

  it('treats a null row title the same way — it also means «none yet»', () => {
    expect(pickFinalTitle({ rowTitle: null, generatedTitle: 'Отчёт по продажам' })).toBe(
      'Отчёт по продажам',
    );
  });

  it('never overwrites a title the row already has', () => {
    expect(pickFinalTitle({ rowTitle: 'Настоящий', generatedTitle: 'Другой' })).toBe('Настоящий');
  });

  it('changes nothing when no title was generated', () => {
    expect(pickFinalTitle({ rowTitle: 'New Chat', generatedTitle: undefined })).toBe('New Chat');
    expect(pickFinalTitle({ rowTitle: null, generatedTitle: undefined })).toBeNull();
  });

  it('does not promote the placeholder — «New Chat» is not a title', () => {
    expect(pickFinalTitle({ rowTitle: null, generatedTitle: 'New Chat' })).toBeNull();
  });
});

describe('hasRealTitle', () => {
  it('rejects exactly the values that mean «no title yet»', () => {
    expect(hasRealTitle('New Chat')).toBe(false);
    expect(hasRealTitle('')).toBe(false);
    expect(hasRealTitle(null)).toBe(false);
    expect(hasRealTitle(undefined)).toBe(false);
  });

  it('accepts a real one, including a title that merely contains the placeholder', () => {
    expect(hasRealTitle('Презентация погоды')).toBe(true);
    expect(hasRealTitle('New Chat feature review')).toBe(true);
  });
});

/* Two questions the ended-job path used to answer with one flag, which is the whole
 * bug. Measured on the stand: the owner stopped a presentation run by hand at 07:55
 * UTC on 2026-09-09; its title had been generated and billed four seconds in
 * (`db.transactions` context=title) and the chat still came out «New Chat».
 *
 * Why: a user Stop does NOT reach the controller's catch — `chatCompletion` swallows
 * its own abort, so the run unwinds by the success path. There the job is already gone
 * (`abortJob` deletes it; `cleanupOnComplete` defaults to true), and the single flag
 * `!currentJob || createdAt mismatch` meant BOTH «skip the final emit» — right, the
 * aborted final was already sent — AND «throw the title away» — wrong, nobody took the
 * conversation over.
 *
 * The pairing below is the contract: on a Stop, silence yes, discard no.
 */
describe('an ended job: emit and discard are different questions', () => {
  const MINE = 1000;

  it('a Stop deletes the job: stay silent, but keep the title', () => {
    expect(shouldSkipFinalEmit(undefined, MINE)).toBe(true);
    expect(isSupersededByNewerJob(undefined, MINE)).toBe(false);
    expect(shouldSkipFinalEmit(null, MINE)).toBe(true);
    expect(isSupersededByNewerJob(null, MINE)).toBe(false);
  });

  it('a newer job owns the conversation: stay silent AND drop the title', () => {
    expect(shouldSkipFinalEmit({ createdAt: 2000 }, MINE)).toBe(true);
    expect(isSupersededByNewerJob({ createdAt: 2000 }, MINE)).toBe(true);
  });

  it('the job in the store is still this one: emit, and keep the title', () => {
    expect(shouldSkipFinalEmit({ createdAt: MINE }, MINE)).toBe(false);
    expect(isSupersededByNewerJob({ createdAt: MINE }, MINE)).toBe(false);
  });

  /* The pair must never agree that a title should go when the run was merely ended —
   * the one shape that is not «someone else's job» is an absent one. */
  it('discard is never broader than silence', () => {
    for (const job of [undefined, null, { createdAt: MINE }, { createdAt: 2000 }]) {
      if (isSupersededByNewerJob(job, MINE)) {
        expect(shouldSkipFinalEmit(job, MINE)).toBe(true);
      }
    }
  });
});

/* The wiring, not just the predicate. Two earlier attempts at this fix each had a
 * green test suite and shipped the bug anyway, because the tests pinned the QUESTION
 * while the defect lived in what was done with the answer. These assert the effects. */
describe('settleTitleForEndedJob — what actually happens to the two controllers', () => {
  const MINE = 1000;
  const controllers = () => ({
    titleAbortController: { abort: jest.fn() },
    titleDiscardController: { abort: jest.fn() },
  });

  it('a stopped run: generation cancelled, finished title kept', () => {
    const c = controllers();
    settleTitleForEndedJob({ currentJob: undefined, jobCreatedAt: MINE, ...c });

    expect(c.titleAbortController.abort).toHaveBeenCalledTimes(1);
    expect(c.titleDiscardController.abort).not.toHaveBeenCalled();
  });

  it('a newer job owns the conversation: both, the title is not ours to keep', () => {
    const c = controllers();
    settleTitleForEndedJob({ currentJob: { createdAt: 2000 }, jobCreatedAt: MINE, ...c });

    expect(c.titleAbortController.abort).toHaveBeenCalledTimes(1);
    expect(c.titleDiscardController.abort).toHaveBeenCalledTimes(1);
  });

  it('the same job still in the store: generation cancelled, title kept', () => {
    const c = controllers();
    settleTitleForEndedJob({ currentJob: { createdAt: MINE }, jobCreatedAt: MINE, ...c });

    expect(c.titleAbortController.abort).toHaveBeenCalledTimes(1);
    expect(c.titleDiscardController.abort).not.toHaveBeenCalled();
  });
});
