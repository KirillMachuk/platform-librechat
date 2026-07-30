import axios from 'axios';
import { CacheKeys, Time } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import type { ModelCapabilities, ModelCapabilityMap } from 'librechat-data-provider';
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
 * Nothing about pricing is read or stored. Money is accounted for outside the
 * platform, from what the provider actually charged, and this module must stay out
 * of it — see `MODEL_CAPABILITIES_Plan.md`.
 */

/** Shape of the entries returned by an OpenRouter-compatible `/models` route. */
interface CatalogueModel {
  id?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
  };
  supported_parameters?: unknown;
  top_provider?: {
    context_length?: unknown;
    max_completion_tokens?: unknown;
  };
}

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
 * Parsed catalogues by base URL, with the moment each stops being reused. Holds one
 * small record per model of each endpoint — bounded by how many endpoints exist.
 */
const memo = new Map<string, { capabilities: ModelCapabilityMap; expiresAt: number }>();

/** Test seam: forgets what this process is holding. */
export function clearModelCapabilityMemo(): void {
  memo.clear();
}

/**
 * Cache namespace. Deliberately not the `vision:` prefix an earlier revision used:
 * that one holds `string[]`, and a rolling deploy must not read those as the
 * capability records this module now stores.
 */
const cacheKeyFor = (baseURL: string) => `capabilities:${baseURL}`;

/** Reads a positive integer, or undefined for anything else (strings, null, NaN). */
function toPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** `undefined` (not `false`) when the catalogue did not publish the list at all. */
function listIncludes(list: unknown, member: string): boolean | undefined {
  return Array.isArray(list) ? list.includes(member) : undefined;
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

  return {
    vision: listIncludes(entry?.architecture?.input_modalities, 'image'),
    tools: listIncludes(entry?.supported_parameters, 'tools'),
    contextTokens: contextCandidates.length > 0 ? Math.min(...contextCandidates) : undefined,
    maxOutputTokens: toPositiveInt(entry?.top_provider?.max_completion_tokens),
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

  const now = Date.now();
  const held = memo.get(baseURL);
  if (held && held.expiresAt > now) {
    return held.capabilities;
  }

  const cache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = cacheKeyFor(baseURL);

  /** Keeps the parsed answer in this process too, so the repeats within one
   *  request cost nothing. */
  const hold = (capabilities: ModelCapabilityMap) => {
    memo.set(baseURL, { capabilities, expiresAt: Date.now() + PROCESS_MEMO_MS });
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
