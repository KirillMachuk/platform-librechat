import axios from 'axios';
import crypto from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import { CacheKeys, Time } from 'librechat-data-provider';
import type {
  ModelCapabilities,
  ModelCapabilityMap,
  ModelOutputType,
  ModelPriceTier,
  TEndpointsConfig,
} from 'librechat-data-provider';
import { standardCache } from '~/cache';

/**
 * What each model of an endpoint can do, according to the gateway that serves it —
 * rather than guessed from substrings of the model name.
 *
 * Name-matching lists (`visionModels`, `maxTokensMap` in data-provider) have to be
 * edited by hand for every new model, and a model line-up changes weekly. When they
 * lag, the failure is not neutral: an employee attaching a picture to a
 * vision-capable model is told their model cannot read images and to switch to one
 * that can. That is what happened when the Claude 5 family shipped.
 *
 * OpenAI-compatible gateways that follow OpenRouter's catalogue shape publish this
 * per model, so the answer is available over the connection the endpoint is already
 * configured with — no extra credentials and no egress the deployment does not
 * already make. Gateways that do not publish it simply yield nothing here and every
 * caller keeps its previous behaviour.
 *
 * Money stays outside. The catalogue's price fields are read here for exactly one
 * purpose — cutting a model into a coarse cost band an operator can see before
 * turning it on — and for nothing else: no rate is written to the config, none is
 * sent to employees, and nothing on the charging path (the provider's own
 * `usage.cost`, collected by the anonymizer into the ledger) goes through this
 * module. See `MODEL_CAPABILITIES_Plan.md`, "Деньги отделены".
 */

/** Shape of the entries returned by an OpenRouter-compatible `/models` route. */
interface CatalogueModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  created?: unknown;
  expiration_date?: unknown;
  alias_target?: {
    slug?: unknown;
  };
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  supported_parameters?: unknown;
  top_provider?: {
    context_length?: unknown;
    max_completion_tokens?: unknown;
  };
  /** USD per token, as strings. */
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: unknown;
    };
  };
}

/**
 * Marks a no-cost variant, from the id rather than from the price.
 *
 * `:free` is the catalogue's own suffix for it, and it is the honest signal: the
 * price fields are per unit of the model's own modality, so a music model billed
 * per second also reads as zero per token and would be mislabelled. Reading price
 * here would also drag money into a module that deliberately stays out of it.
 */
const FREE_VARIANT_SUFFIX = ':free';

/** How long a catalogue answer is reused. Model line-ups change on the order of
 *  days, and the gateway caches upstream as well, so an hour is generous. */
const CACHE_TTL = Time.ONE_HOUR;

/**
 * How long "the gateway told us nothing" is remembered.
 *
 * Load-bearing, not an optimisation. The endpoints config is rebuilt on the
 * message path (`buildEndpointOption`, `validateModel`), so an uncached empty
 * answer means an HTTP round trip to the gateway on *every message* — and up to
 * `REQUEST_TIMEOUT_MS` of added latency per message if that route hangs while the
 * completions route stays healthy. Short enough that a gateway coming back is
 * picked up quickly, long enough that nothing hammers it.
 */
const EMPTY_CACHE_TTL = Time.TWO_MINUTES;

/** The gateway is not on the critical path here — a slow answer must not hold up
 *  the endpoints config, it just means callers fall back for a while. */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * How long the parsed answer is kept in this process, in front of the shared cache.
 *
 * The endpoints config is rebuilt several times while serving one request — twice
 * on the message path (`validateModel`, `buildEndpointOption`) and once per
 * `checkCapability` on the file paths — and each rebuild would otherwise fetch and
 * re-parse a whole catalogue from the shared cache. A real one is ~38 kB of JSON,
 * so that is the same blob deserialized up to eight times to answer one request.
 *
 * Far shorter than `CACHE_TTL`, so the hourly refresh and the short empty-answer
 * retry both still behave as written; this only collapses the repeats inside a
 * request and its immediate neighbours.
 */
const PROCESS_MEMO_MS = 10_000;

/**
 * Parsed catalogues by cache key, with the moment each stops being reused. Holds one
 * small record per model of each endpoint — bounded by how many endpoints exist.
 */
const memo = new Map<string, { capabilities: ModelCapabilityMap; expiresAt: number }>();

/** Test seam: forgets what this process is holding. */
export function clearModelCapabilityMemo(): void {
  memo.clear();
}

/**
 * Cache namespace, keyed by the whole request identity rather than the URL alone.
 *
 * Two endpoints can point at the same gateway with different keys — per-team
 * entitlements, or a proxy where the key selects the served subset — and keying on
 * the URL made whichever resolved first answer for both. `models.ts` hashes
 * `baseURL:apiKey` for exactly this reason.
 *
 * Deliberately not the `vision:` prefix an earlier revision used: that one holds
 * `string[]`, and a rolling deploy must not read those as the capability records
 * this module now stores.
 */
const cacheKeyFor = (baseURL: string, apiKey: string) =>
  `capabilities:${crypto.createHash('sha256').update(`${baseURL}:${apiKey}`).digest('hex').slice(0, 32)}`;

/** Reads a positive integer, or undefined for anything else (strings, null, NaN). */
function toPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** `undefined` (not `false`) when the catalogue did not publish the list at all. */
function listIncludes(list: unknown, member: string): boolean | undefined {
  return Array.isArray(list) ? list.includes(member) : undefined;
}

/** Reads a non-blank string, or undefined for anything else. */
function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * A retirement date is only carried through when it is a real calendar date.
 *
 * It is rendered as a deadline, and a deadline nobody can act on is worse than
 * silence — so anything the catalogue publishes in another shape is dropped
 * rather than shown verbatim.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: unknown): string | undefined {
  const text = toText(value);
  if (text == null || !ISO_DATE.test(text)) {
    return undefined;
  }
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}

/** Reads a finite number from a number or a numeric string; prices arrive as strings. */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  /** `Number('')` and `Number(null)` are both 0, which would read as a free model. */
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A bound on the vendor blurb, not a formatter.
 *
 * This is the one field of a record whose length nothing upstream constrains, and
 * the record is cached and multiplied by every model of a catalogue. Real ones run
 * to a couple of hundred characters, so the cut only ever fires on something
 * pathological.
 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * What the model answers with, when the catalogue lists more than one.
 *
 * A picture-or-audio model also emits the text around its answer, so `text` is
 * present on nearly everything and is the least informative of the three. The
 * distinctive modality wins.
 */
const OUTPUT_TYPES: ModelOutputType[] = ['image', 'audio', 'text'];

function toOutputType(value: unknown): ModelOutputType | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return OUTPUT_TYPES.find((type) => value.includes(type));
}

/**
 * How much input weighs against output in the blend.
 *
 * Chats read far more than they write — a long thread, an attached document and a
 * system prompt all get re-sent with every turn, against a few hundred tokens of
 * answer. Weighting the two equally would rank a model with cheap input and dear
 * output as costlier than it is in use.
 */
const INPUT_WEIGHT = 3;

/**
 * Where one band ends and the next begins, in USD per million blended tokens.
 *
 * Absolute figures rather than quantiles of the catalogue: a band that means
 * "cheaper than most of what is on offer today" would re-label models on a day
 * nobody touched them, and "Эконом" has to keep meaning the same thing. Checked
 * against the line-up this stand actually runs — DeepSeek V3.1 at 0.4 and the
 * cheap OpenAI tiers land in the first band, GLM and Qwen Max in the second,
 * Sonnet and Kimi in the third, Opus in the fourth.
 */
const TIER_CEILINGS: ReadonlyArray<readonly [ModelPriceTier, number]> = [
  ['economy', 1],
  ['standard', 3],
  ['premium', 8],
];

/** The band above the last ceiling. */
const TOP_TIER: ModelPriceTier = 'top';

/**
 * The cost band of a model, and the blend it was cut from.
 *
 * Answers nothing at all unless per-token prices actually describe what the model
 * costs. A free variant reads as zero; a router (`openrouter/auto`) publishes `-1`
 * because its price is whatever it routes to; and a model that answers in pictures
 * or audio is billed per image or per second, next to which its token prices are a
 * rounding error. Each of those would otherwise be labelled the cheapest thing on
 * the screen.
 */
function priceBandOf(
  pricing: CatalogueModel['pricing'],
  outputType: ModelOutputType | undefined,
): { priceTier: ModelPriceTier; priceBlend: number } | undefined {
  if (outputType !== 'text') {
    return undefined;
  }
  const prompt = toFiniteNumber(pricing?.prompt);
  const completion = toFiniteNumber(pricing?.completion);
  if (prompt == null || completion == null || prompt < 0 || completion < 0) {
    return undefined;
  }
  const blend = ((INPUT_WEIGHT * prompt + completion) / (INPUT_WEIGHT + 1)) * 1e6;
  if (!(blend > 0)) {
    return undefined;
  }
  const tier = TIER_CEILINGS.find(([, ceiling]) => blend < ceiling)?.[0] ?? TOP_TIER;
  /** Four decimals keeps the cheapest models apart without pretending to be a rate. */
  return { priceTier: tier, priceBlend: Math.round(blend * 1e4) / 1e4 };
}

/**
 * Parses one catalogue entry. Exported for tests: this is the part with decisions.
 *
 * The context window is the smaller of the two figures a catalogue may carry — the
 * model's own and the serving provider's. Overstating it is the harmful direction:
 * the provider rejects the request outright, whereas understating it only trims
 * history earlier than necessary.
 */
export function extractCapabilities(entry: CatalogueModel): ModelCapabilities {
  const contextCandidates = [
    toPositiveInt(entry?.context_length),
    toPositiveInt(entry?.top_provider?.context_length),
  ].filter((value): value is number => value != null);

  const id = toText(entry?.id);
  const outputType = toOutputType(entry?.architecture?.output_modalities);
  const intelligence = toFiniteNumber(entry?.benchmarks?.artificial_analysis?.intelligence_index);

  return {
    vision: listIncludes(entry?.architecture?.input_modalities, 'image'),
    tools: listIncludes(entry?.supported_parameters, 'tools'),
    contextTokens: contextCandidates.length > 0 ? Math.min(...contextCandidates) : undefined,
    maxOutputTokens: toPositiveInt(entry?.top_provider?.max_completion_tokens),
    name: toText(entry?.name),
    releasedAt: toPositiveInt(entry?.created),
    retiresOn: toIsoDate(entry?.expiration_date),
    aliasOf: toText(entry?.alias_target?.slug),
    /** Only ever `true`: "not a free variant" is the norm and needs no field. */
    free: id?.endsWith(FREE_VARIANT_SUFFIX) === true ? true : undefined,
    description: toText(entry?.description)?.slice(0, MAX_DESCRIPTION_LENGTH),
    outputType,
    intelligence: intelligence != null && intelligence >= 0 ? intelligence : undefined,
    ...priceBandOf(entry?.pricing, outputType),
  };
}

/**
 * Builds the capability map from a `/models` payload.
 *
 * Tolerant by design: an entry it cannot read is skipped rather than throwing the
 * whole answer away, and a model whose metadata is missing still gets a (blank)
 * record so callers can tell "the gateway serves this model but said nothing about
 * it" from "the gateway has never heard of it".
 */
export function extractModelCapabilities(payload: unknown): ModelCapabilityMap {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return {};
  }

  const capabilities: ModelCapabilityMap = {};
  for (const entry of data as CatalogueModel[]) {
    if (typeof entry?.id !== 'string' || entry.id === '') {
      continue;
    }
    capabilities[entry.id] = extractCapabilities(entry);
  }
  return capabilities;
}

/**
 * Points out models an endpoint advertises that its own gateway does not serve —
 * a typo in the config, or a model the provider retired. Today the first sign of
 * either is an employee getting a provider error mid-chat.
 *
 * Called only when the catalogue was actually fetched (i.e. on a cache miss), so it
 * cannot spam the log on the message path.
 */
function warnUnservedModels(
  baseURL: string,
  configuredModels: string[] | undefined,
  capabilities: ModelCapabilityMap,
): void {
  if (!configuredModels?.length || Object.keys(capabilities).length === 0) {
    return;
  }
  const unserved = configuredModels.filter(
    (model) => typeof model === 'string' && capabilities[model] == null,
  );
  if (unserved.length > 0) {
    logger.warn(
      `[modelCapabilities] ${baseURL} does not serve configured model(s): ${unserved.join(', ')} — typo, or retired upstream. They will fail when selected.`,
    );
  }
}

/**
 * Asks the endpoint's own gateway what its models can do.
 *
 * @returns capabilities by model id, or `{}` when the gateway does not say — never
 * throws, because a capability hint must not be able to break the endpoints config
 * it rides along with.
 */
export async function fetchModelCapabilities({
  baseURL,
  apiKey,
  configuredModels,
}: {
  baseURL?: string;
  apiKey?: string;
  /** Models this endpoint advertises, checked against the catalogue for typos. */
  configuredModels?: string[];
}): Promise<ModelCapabilityMap> {
  if (!baseURL || !apiKey) {
    return {};
  }

  const cacheKey = cacheKeyFor(baseURL, apiKey);

  const now = Date.now();
  const held = memo.get(cacheKey);
  if (held && held.expiresAt > now) {
    return held.capabilities;
  }

  const cache = standardCache(CacheKeys.MODEL_QUERIES);

  /** Keeps the parsed answer in this process too, so the repeats within one
   *  request cost nothing. Same key as the shared cache, so two endpoints on one
   *  gateway with different keys do not answer for each other here either. */
  const hold = (capabilities: ModelCapabilityMap) => {
    memo.set(cacheKey, { capabilities, expiresAt: Date.now() + PROCESS_MEMO_MS });
    return capabilities;
  };

  try {
    const cached = await cache.get(cacheKey);
    if (cached != null && typeof cached === 'object' && !Array.isArray(cached)) {
      return hold(cached as ModelCapabilityMap);
    }
  } catch (error) {
    logger.debug('[fetchModelCapabilities] cache read failed', error);
  }

  /** Never let a cache write failure turn into a failed config load. */
  const remember = async (capabilities: ModelCapabilityMap, ttl: number) => {
    try {
      await cache.set(cacheKey, capabilities, ttl);
    } catch (error) {
      logger.debug('[fetchModelCapabilities] cache write failed', error);
    }
  };

  try {
    const { data } = await axios.get(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const capabilities = extractModelCapabilities(data);
    const answered = Object.keys(capabilities).length > 0;
    if (answered) {
      warnUnservedModels(baseURL, configuredModels, capabilities);
    }
    await remember(capabilities, answered ? CACHE_TTL : EMPTY_CACHE_TTL);
    return hold(capabilities);
  } catch (error) {
    logger.debug(
      `[fetchModelCapabilities] ${baseURL} did not report model capabilities; callers fall back to name matching`,
      error,
    );
    await remember({}, EMPTY_CACHE_TTL);
    return hold({});
  }
}

/**
 * Answers whether the gateway said, in so many words, that this model takes no
 * tools — so a caller can refuse the combination instead of letting it fail
 * silently at run time.
 *
 * Deliberately one-directional. An absent answer means the catalogue did not
 * publish `supported_parameters` for the model, or the gateway was unreachable
 * when the config was assembled, and neither is the same statement as "no". Only
 * an explicit `false` is treated as a refusal, so a silent gateway costs the user
 * nothing and this can never become the reason a save stops working.
 */
export function reportsNoToolSupport(
  endpointsConfig: TEndpointsConfig | undefined | null,
  endpoint: string | undefined | null,
  model: string | undefined | null,
): boolean {
  if (!endpoint || !model) {
    return false;
  }
  return endpointsConfig?.[endpoint]?.modelCapabilities?.[model]?.tools === false;
}
