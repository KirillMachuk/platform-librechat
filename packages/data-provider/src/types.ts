import type { InfiniteData } from '@tanstack/react-query';
import type {
  TConversationTag,
  EModelEndpoint,
  TConversation,
  TSharedLink,
  TAttachment,
  TMessage,
  TBanner,
  ReasoningResponseKey,
  ReasoningParameterFormat,
} from './schemas';
import type { TUserPreferences } from './preferences';
import type { RefillIntervalUnit } from './balance';
import type { SettingDefinition } from './generate';
import type { TMinimalFeedback } from './feedback';
import type { ContentTypes } from './types/runs';
import type { Agent } from './types/assistants';

export * from './schemas';

export type TMessages = TMessage[];

/* TODO: Cleanup EndpointOption types */
export type TEndpointOption = Pick<
  TConversation,
  // Core conversation fields
  | 'endpoint'
  | 'endpointType'
  | 'model'
  | 'modelLabel'
  | 'chatGptLabel'
  | 'promptPrefix'
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'top_p'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'maxOutputTokens'
  | 'maxContextTokens'
  | 'max_tokens'
  | 'maxTokens'
  | 'resendFiles'
  | 'imageDetail'
  | 'reasoning_effort'
  | 'verbosity'
  | 'instructions'
  | 'additional_instructions'
  | 'append_current_datetime'
  | 'tools'
  | 'stop'
  | 'region'
  | 'additionalModelRequestFields'
  // Anthropic-specific
  | 'promptCache'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'effort'
  | 'thinkingDisplay'
  // Assistant/Agent fields
  | 'assistant_id'
  | 'agent_id'
  // UI/Display fields
  | 'iconURL'
  | 'greeting'
  | 'spec'
  // Artifacts
  | 'artifacts'
  // Files
  | 'file_ids'
  // System field
  | 'system'
  | 'chatProjectId'
  // Google examples
  | 'examples'
  // Context
  | 'context'
> & {
  // Fields specific to endpoint options that don't exist on TConversation
  modelDisplayLabel?: string;
  key?: string | null;
  /** @deprecated Assistants API */
  thread_id?: string;
  // Conversation identifiers for multi-response streams
  overrideConvoId?: string;
  overrideUserMessageId?: string;
  // Model parameters (used by different endpoints)
  modelOptions?: Record<string, unknown>;
  model_parameters?: Record<string, unknown>;
  // Configuration data (added by middleware)
  modelsConfig?: TModelsConfig;
  // File attachments (processed by middleware)
  attachments?: TAttachment[];
  // Generated prompts
  artifactsPrompt?: string;
  // Agent-specific fields
  agent?: Promise<Agent>;
  // Client-specific options
  clientOptions?: Record<string, unknown>;
};

export type TEphemeralAgent = {
  mcp?: string[];
  web_search?: boolean;
  file_search?: boolean;
  execute_code?: boolean;
  artifacts?: string;
  skills?: boolean;
  /** Deep Research mode for this turn — assembles the orchestrator→worker→writer graph. */
  deep_research?: boolean;
};

export type TPayload = Partial<TMessage> &
  Partial<TEndpointOption> & {
    isContinued: boolean;
    isRegenerate?: boolean;
    conversationId: string | null;
    /**
     * Binds the request to a Project so the agents pipeline can attach
     * project-level instructions and file_search resources. Sourced from
     * `submission.conversation.project_id`, which is set when the user
     * opens a chat from inside a Project. Required for NEW conversations
     * because the backend cannot look up `project_id` via `conversationId`
     * until the convo is persisted.
     */
    project_id?: string;
    messages?: TMessages;
    isTemporary: boolean;
    ephemeralAgent?: TEphemeralAgent | null;
    editedContent?: TEditedContent | null;
    /** Added conversation for multi-convo feature */
    addedConvo?: TConversation;
    /**
     * Skills the user selected via the `$` popover for this turn. Names, not IDs
     * — the backend resolves them against the user's ACL-accessible skill set,
     * loads each SKILL.md body, and prepends one meta user message per skill
     * before the LLM turn runs.
     */
    manualSkills?: string[];
  };

export type TEditedContent =
  | {
      index: number;
      type: ContentTypes.THINK;
      [ContentTypes.THINK]: string;
    }
  | {
      index: number;
      type: ContentTypes.TEXT;
      [ContentTypes.TEXT]: string;
    };

export type TSubmission = {
  userMessage: TMessage;
  isEdited?: boolean;
  isContinued?: boolean;
  isTemporary: boolean;
  messages: TMessage[];
  /** Client-only full message context used to restore branch siblings after scoped regenerate. */
  regenerateMessages?: TMessage[];
  isRegenerate?: boolean;
  initialResponse?: TMessage;
  conversation: Partial<TConversation>;
  endpointOption: TEndpointOption;
  clientTimestamp?: string;
  ephemeralAgent?: TEphemeralAgent | null;
  editedContent?: TEditedContent | null;
  /** Added conversation for multi-convo feature */
  addedConvo?: TConversation;
  /** Skills the user invoked via the `$` popover for this submission. */
  manualSkills?: string[];
};

export type EventSubmission = Omit<TSubmission, 'initialResponse'> & { initialResponse: TMessage };

export type TPluginAction = {
  pluginKey: string;
  action: 'install' | 'uninstall';
  auth?: Partial<Record<string, string>> | null;
  isEntityTool?: boolean;
};

export type GroupedConversations = [key: string, TConversation[]][];

export type TUpdateUserPlugins = {
  isEntityTool?: boolean;
  pluginKey: string;
  action: string;
  auth?: Partial<Record<string, string | null>> | null;
};

// TODO `label` needs to be changed to the proper `TranslationKeys`
export type TCategory = {
  id?: string;
  value: string;
  label: string;
  description?: string;
  custom?: boolean;
};

export type TMarketplaceCategory = TCategory & {
  count: number;
};

export type TError = {
  message: string;
  code?: number | string;
  response?: {
    data?: {
      message?: string;
    };
    status?: number;
  };
};

export type TBackupCode = {
  codeHash: string;
  used: boolean;
  usedAt: Date | null;
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  avatar: string;
  role: string;
  provider: string;
  tenantId?: string;
  plugins?: string[];
  twoFactorEnabled?: boolean;
  backupCodes?: TBackupCode[];
  personalization?: {
    memories?: boolean;
  };
  /** Personal interface settings that follow the account rather than the browser. */
  preferences?: TUserPreferences;
  createdAt: string;
  updatedAt: string;
};

export type TGetConversationsResponse = {
  conversations: TConversation[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
};

export type TUpdateMessageRequest = {
  conversationId: string;
  messageId: string;
  model: string;
  text: string;
};

export type TUpdateMessageContent = {
  conversationId: string;
  messageId: string;
  index: number;
  text: string;
};

export type TUpdateUserKeyRequest = {
  name: string;
  value: string;
  expiresAt: string;
};

export type TAgentApiKeyCreateRequest = {
  name: string;
  expiresAt?: string | null;
};

export type TAgentApiKeyCreateResponse = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string;
};

export type TAgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
};

export type TAgentApiKeyListResponse = {
  keys: TAgentApiKeyListItem[];
};

export type TUpdateConversationRequest = {
  conversationId: string;
  title: string;
};

export type TUpdateConversationResponse = TConversation;

export type TChatProject = {
  _id: string;
  name: string;
  description?: string;
  user?: string;
  conversationCount: number;
  lastConversationAt?: string | null;
  lastConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TCreateChatProjectRequest = {
  name: string;
  description?: string;
};

export type TUpdateChatProjectRequest = Partial<TCreateChatProjectRequest> & {
  projectId: string;
};

export type TDeleteChatProjectResponse = {
  deletedCount: number;
  modifiedCount: number;
};

export type TAssignConversationToProjectRequest = {
  conversationId: string;
  projectId: string | null;
};

export type TAssignConversationToProjectResponse = {
  conversation: TConversation;
  previousProjectId: string | null;
  projectId: string | null;
};

export type TDeleteConversationRequest = {
  conversationId?: string;
  thread_id?: string;
  endpoint?: string;
  source?: string;
};

export type TDeleteConversationResponse = {
  acknowledged: boolean;
  deletedCount: number;
  messages: {
    acknowledged: boolean;
    deletedCount: number;
  };
};

export type TArchiveConversationRequest = {
  conversationId: string;
  isArchived: boolean;
};

export type TArchiveConversationResponse = TConversation;

export type TReadConversationRequest = {
  conversationId: string;
};

export type TReadConversationResponse = {
  conversationId: string;
  lastReadAt: string;
};

export type TSharedMessagesResponse = Omit<TSharedLink, 'messages'> & {
  messages: TMessage[];
};

export type TCreateShareLinkRequest = Pick<TConversation, 'conversationId'>;

export type TUpdateShareLinkRequest = Pick<TSharedLink, 'shareId' | 'targetMessageId'>;

export type TSharedLinkResponse = Pick<TSharedLink, 'shareId'> &
  Pick<TSharedLink, 'targetMessageId'> &
  Pick<TConversation, 'conversationId'> & {
    _id?: string;
  };

export type TSharedLinkGetResponse = Omit<TSharedLinkResponse, 'shareId'> & {
  shareId: string | null;
  success: boolean;
};

// type for getting conversation tags
export type TConversationTagsResponse = TConversationTag[];
// type for creating conversation tag
export type TConversationTagRequest = Partial<
  Omit<TConversationTag, 'createdAt' | 'updatedAt' | 'count' | 'user'>
> & {
  conversationId?: string;
  addToConversation?: boolean;
};

export type TConversationTagResponse = TConversationTag;

export type TTagConversationRequest = {
  tags: string[];
  tag: string;
};

export type TTagConversationResponse = string[];

export type TDuplicateConvoRequest = {
  conversationId?: string;
};

export type TDuplicateConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TForkConvoRequest = {
  messageId: string;
  conversationId: string;
  option?: string;
  splitAtTarget?: boolean;
  latestMessageId?: string;
};

export type TForkConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TSearchResults = {
  conversations: TConversation[];
  messages: TMessage[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  filter: object;
};

/**
 * What a gateway reports about one of its models.
 *
 * Every field is optional and means "the catalogue did not say" when absent —
 * deliberately distinct from `false`/`0`. Callers must treat the two differently:
 * a stated `false` is an answer, an absent field means fall back to whatever the
 * caller did before (name matching, static token maps). Getting this wrong is how
 * a gateway that publishes ids but no metadata would tell everyone their model
 * cannot read images.
 *
 * Only fields with a consumer live here; the catalogue carries more (structured
 * output, reasoning params, prompt caching) and they can be added when something
 * needs them.
 */
export type ModelCapabilities = {
  /** Accepts image input. */
  vision?: boolean;
  /** Accepts tool/function calling — required by web search, file search and agents. */
  tools?: boolean;
  /** Context window in tokens. */
  contextTokens?: number;
  /** Ceiling on a single response, in tokens. */
  maxOutputTokens?: number;
  /** Display name as the catalogue publishes it, e.g. "Anthropic: Claude Sonnet 5". */
  name?: string;
  /** When the model was published, in seconds since the epoch. */
  releasedAt?: number;
  /**
   * The date the provider retires this model, as published (`YYYY-MM-DD`). Absent
   * for the overwhelming majority — a present value is a deadline, not a detail:
   * the model stops answering that day whether or not anyone noticed.
   */
  retiresOn?: string;
  /**
   * The model id this one currently resolves to, when the id is a moving pointer
   * (`~vendor/family-latest`) rather than a model. What it points at changes when
   * the vendor ships a successor, so anything selecting it silently changes model.
   */
  aliasOf?: string;
  /**
   * A no-cost variant of a model, which providers serve from a shared pool under
   * tighter limits and looser data terms than the paid twin.
   */
  free?: boolean;
  /**
   * The vendor's own one-paragraph description, in the language the catalogue
   * publishes it (English). Says what the model is for, which nothing else in the
   * record does — an id and a context window do not tell an operator whether a
   * model is a coding specialist or a cheap summariser.
   */
  description?: string;
  /**
   * What the model produces. Absent when the catalogue did not say.
   *
   * `text` for the overwhelming majority; `image` and `audio` mark models whose
   * answer is a picture or a sound, which behave differently enough in a chat that
   * offering them unmarked is a trap.
   */
  outputType?: ModelOutputType;
  /**
   * Roughly what a million tokens costs, as a band rather than a figure — see
   * {@link ModelPriceTier}.
   */
  priceTier?: ModelPriceTier;
  /**
   * The number the band was cut from: USD per million tokens, input and output
   * weighted 3:1 (real conversations read far more than they write).
   *
   * A sort key, not a rate. It is a blend of two published prices and matches no
   * invoice line, so it is never rendered — surfaced only so a list can be put in
   * cost order, which bands alone cannot do when half the catalogue is one band.
   * Absent whenever {@link priceTier} is.
   */
  priceBlend?: number;
  /**
   * Artificial Analysis' intelligence index, as the catalogue republishes it —
   * one number combining their benchmark suite, higher is stronger. Published for
   * roughly a third of a real catalogue; absent for the rest, which is not a
   * statement that those models are weak.
   */
  intelligence?: number;
};

/** What a model produces, from the catalogue's output modalities. */
export type ModelOutputType = 'text' | 'image' | 'audio';

/**
 * A coarse cost band for a model, in place of a price.
 *
 * Money is accounted for outside the platform, and an exact rate shown here would
 * be a second source of truth that drifts. A band answers the question an operator
 * actually has — "is turning this on going to be expensive?" — and stays true
 * through the small price changes that would make a figure wrong.
 *
 * Absent when per-token prices do not describe the model's cost at all: a free
 * variant, a router whose price depends on where it routes, or a model billed per
 * image or per second of audio.
 */
export type ModelPriceTier = 'economy' | 'standard' | 'premium' | 'top';

/** Capabilities of every model a gateway published, keyed by model id. */
export type ModelCapabilityMap = Record<string, ModelCapabilities>;

export type TConfig = {
  order: number;
  type?: EModelEndpoint;
  azure?: boolean;
  availableTools?: [];
  availableRegions?: string[];
  allowedProviders?: (string | EModelEndpoint)[];
  plugins?: Record<string, string>;
  name?: string;
  iconURL?: string;
  version?: string;
  modelDisplayLabel?: string;
  userProvide?: boolean | null;
  userProvideURL?: boolean | null;
  userProvideAccessKeyId?: boolean;
  userProvideSecretAccessKey?: boolean;
  userProvideSessionToken?: boolean;
  userProvideBearerToken?: boolean;
  disableBuilder?: boolean;
  retrievalModels?: string[];
  capabilities?: string[];
  /**
   * Model parameters the backend drops before sending to the provider
   * (custom-endpoint `dropParams`). Surfaced to the client so the Parameters
   * panel can hide settings that would otherwise be silently ignored.
   */
  dropParams?: string[];
  /**
   * What this endpoint's gateway says each of its models can do, keyed by model id.
   * Present only when the gateway publishes a catalogue (OpenRouter-compatible ones
   * do); consumers fall back to name matching when it — or an individual field —
   * is absent. Keeps capability hints correct as the line-up changes without
   * anyone editing a list of names.
   */
  modelCapabilities?: ModelCapabilityMap;
  customParams?: {
    defaultParamsEndpoint?: string;
    reasoningFormat?: ReasoningParameterFormat;
    reasoningKey?: ReasoningResponseKey;
    paramDefinitions?: Partial<SettingDefinition>[];
  };
};

export type TEndpointsConfig =
  | Record<EModelEndpoint | string, TConfig | null | undefined>
  | undefined;

export type TModelsConfig = Record<string, string[]>;

/** Server-resolved context window and pricing for one model. Rates are USD per 1M tokens. */
export type TModelTokenomics = {
  context?: number;
  prompt?: number;
  completion?: number;
  cacheWrite?: number;
  cacheRead?: number;
};

/** endpoint → model → resolved tokenomics, from GET /api/endpoints/token-config */
export type TTokenConfigMap = Record<string, Record<string, TModelTokenomics>>;

export type TUpdateTokenCountResponse = {
  count: number;
};

export type TMessageTreeNode = object;

export type TSearchMessage = object;

export type TSearchMessageTreeNode = object;

export type TRegisterUserResponse = {
  message: string;
};

export type TRegisterUser = {
  name: string;
  email: string;
  username: string;
  password: string;
  confirm_password?: string;
  token?: string;
};

export type TLoginUser = {
  email: string;
  password: string;
  token?: string;
  backupCode?: string;
};

export type TLoginResponse = {
  token?: string;
  user?: TUser;
  twoFAPending?: boolean;
  tempToken?: string;
};

/** Shared payload for any operation that requires OTP or backup-code verification. */
export type TOTPVerificationPayload = {
  token?: string;
  backupCode?: string;
};

export type TEnable2FARequest = TOTPVerificationPayload;

export type TEnable2FAResponse = {
  otpauthUrl: string;
  backupCodes: string[];
  message?: string;
};

export type TVerify2FARequest = TOTPVerificationPayload;

export type TVerify2FAResponse = {
  message: string;
};

/** For verifying 2FA during login with a temporary token. */
export type TVerify2FATempRequest = TOTPVerificationPayload & {
  tempToken: string;
};

export type TVerify2FATempResponse = {
  token?: string;
  user?: TUser;
  message?: string;
};

export type TDisable2FARequest = TOTPVerificationPayload;

export type TDisable2FAResponse = {
  message: string;
};

export type TRegenerateBackupCodesRequest = TOTPVerificationPayload;

export type TRegenerateBackupCodesResponse = {
  message?: string;
  backupCodes: string[];
  backupCodesHash: TBackupCode[];
};

export type TDeleteUserRequest = TOTPVerificationPayload;

export type TRequestPasswordReset = {
  email: string;
};

export type TResetPassword = {
  userId: string;
  token: string;
  password: string;
  confirm_password?: string;
};

export type VerifyEmailResponse = { message: string };

export type TVerifyEmail = {
  email: string;
  token: string;
};

export type TResendVerificationEmail = Omit<TVerifyEmail, 'token'>;

export type TRefreshTokenResponse = {
  token: string;
  user: TUser;
};

export type TCheckUserKeyResponse = {
  expiresAt: string;
};

export type TRequestPasswordResetResponse = {
  link?: string;
  message?: string;
};

/**
 * Represents the response from the import endpoint.
 */
export type TImportResponse = {
  /**
   * The message associated with the response.
   */
  message: string;
};

/** Prompts */

export type TPrompt = {
  groupId: string;
  author: string;
  prompt: string;
  type: 'text' | 'chat';
  createdAt: string;
  updatedAt: string;
  _id?: string;
};

export type TPromptGroup = {
  name: string;
  numberOfGenerations?: number;
  command?: string;
  oneliner?: string;
  category?: string;
  productionId?: string | null;
  productionPrompt?: Pick<TPrompt, 'prompt'> | null;
  author: string;
  authorName: string;
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  _id?: string;
};

export type TCreatePrompt = {
  prompt: Pick<TPrompt, 'prompt' | 'type'> & { groupId?: string };
  group?: { name: string; category?: string; oneliner?: string; command?: string };
};

export type TCreatePromptRecord = TCreatePrompt & Pick<TPromptGroup, 'author' | 'authorName'>;

export type TPromptsWithFilterRequest = {
  groupId: string;
  tags?: string[];
  projectId?: string;
  version?: number;
};

export type TPromptGroupsWithFilterRequest = {
  category: string;
  pageNumber?: string; // Made optional for cursor-based pagination
  pageSize?: string | number;
  limit?: string | number; // For cursor-based pagination
  cursor?: string; // For cursor-based pagination
  before?: string | null;
  after?: string | null;
  order?: 'asc' | 'desc';
  name?: string;
  author?: string;
};

export type PromptGroupListResponse = {
  promptGroups: TPromptGroup[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  has_more: boolean; // Added for cursor-based pagination
  after: string | null; // Added for cursor-based pagination
};

export type PromptGroupListData = InfiniteData<PromptGroupListResponse>;

export type TCreatePromptResponse = {
  prompt: TPrompt;
  group?: TPromptGroup;
};

export type TUpdatePromptGroupPayload = Partial<TPromptGroup>;

export type TUpdatePromptGroupVariables = {
  id: string;
  payload: TUpdatePromptGroupPayload;
};

export type TUpdatePromptGroupResponse = TPromptGroup;

export type TDeletePromptResponse = {
  prompt: string;
  promptGroup?: { message: string; id: string };
};

export type TDeletePromptVariables = {
  _id: string;
  groupId: string;
};

export type TMakePromptProductionResponse = {
  message: string;
};

export type TMakePromptProductionRequest = {
  id: string;
  groupId: string;
  productionPrompt: Pick<TPrompt, 'prompt'>;
};

export type TUpdatePromptLabelsRequest = {
  id: string;
  payload: {
    labels: string[];
  };
};

export type TUpdatePromptLabelsResponse = {
  message: string;
};

export type TDeletePromptGroupResponse = TUpdatePromptLabelsResponse;

export type TDeletePromptGroupRequest = {
  id: string;
};

export type TGetCategoriesResponse = TCategory[];

export type TGetRandomPromptsResponse = {
  prompts: TPromptGroup[];
};

export type TGetRandomPromptsRequest = {
  limit: number;
  skip: number;
};

export type TCustomConfigSpeechResponse = { [key: string]: string };

export type TUserTermsResponse = {
  termsAccepted: boolean;
};

export type TAcceptTermsResponse = {
  success: boolean;
};

export type TBannerResponse = TBanner | null;

export type TUpdateFeedbackRequest = {
  feedback?: TMinimalFeedback;
};

export type TUpdateFeedbackResponse = {
  messageId: string;
  conversationId: string;
  feedback?: TMinimalFeedback;
};

export type TBalanceResponse = {
  tokenCredits: number;
  // Automatic refill settings
  autoRefillEnabled: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: RefillIntervalUnit;
  lastRefill?: Date | string;
  refillAmount?: number;
};

/* -------------------------------------------------------------------------- */
/* Skill UI extensions (not yet persisted — phase 2 backend will fill these)  */
/* -------------------------------------------------------------------------- */

/**
 * @deprecated Superseded by the persisted `userInvocable` /
 * `disableModelInvocation` pair derived from frontmatter. Retained for the
 * transition window so older UI forms and tests still type-check; the
 * backend no longer reads or writes it.
 */
export enum InvocationMode {
  auto = 'auto',
  manual = 'manual',
  both = 'both',
}

/**
 * Node in the filesystem-style skill tree view. Phase 1 derives these from
 * the flat `TSkillFile[]` list; phase 2 will have the backend serve them
 * directly from a persisted folder hierarchy. Kept in the shared types so
 * tree UI helpers can be imported from both client and server.
 */
export type TSkillNode = {
  _id: string;
  skillId: string;
  parentId: string | null;
  type: 'file' | 'folder';
  name: string;
  fileId?: string;
  order: number;
  author: string;
  createdAt: string;
  updatedAt: string;
};

export type TSkillTreeResponse = {
  nodes: TSkillNode[];
};

export type TCreateSkillNodeRequest = {
  type: 'file' | 'folder';
  name: string;
  parentId?: string | null;
  order?: number;
};

export type TUpdateSkillNodeRequest = {
  name?: string;
  parentId?: string | null;
  order?: number;
};
