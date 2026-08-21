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
