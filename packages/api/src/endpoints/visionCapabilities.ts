import axios from 'axios';
import { CacheKeys, Time } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { standardCache } from '~/cache';

/**
 * Which models can read images, according to the gateway that serves them —
 * rather than guessed from substrings of the model name.
 *
 * The name-matching list (`visionModels` in data-provider) has to be edited by
 * hand for every new model, and a model line-up changes weekly. When it lags,
 * the failure is not neutral: an employee attaching a picture to a
 * vision-capable model is told their model cannot read images and to switch to
 * one that can. That is what happened when the Claude 5 family shipped.
 *
 * OpenAI-compatible gateways that follow OpenRouter's catalogue shape expose
 * `architecture.input_modalities` per model, so the answer is available over the
 * connection the endpoint is already configured with — no extra credentials and
 * no egress the deployment does not already make. Gateways that do not expose it
 * simply yield nothing here and the caller keeps its previous behaviour.
 */

/** Shape of the entries returned by an OpenRouter-compatible `/models` route. */
interface CatalogueModel {
  id?: unknown;
  architecture?: {
    input_modalities?: unknown;
  };
}

/** How long a catalogue answer is reused. Model line-ups change on the order of
 *  days, and the gateway caches upstream as well, so an hour is generous. */
const CACHE_TTL = Time.ONE_HOUR;

/** The gateway is not on the critical path here — a slow answer must not hold up
 *  the endpoints config, it just means the caller falls back for a while. */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Extracts the ids of models whose declared input modalities include images.
 * Exported for tests: this is the part with a decision in it.
 */
export function extractVisionCapableIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of data as CatalogueModel[]) {
    const id = entry?.id;
    const modalities = entry?.architecture?.input_modalities;
    if (typeof id !== 'string' || !Array.isArray(modalities)) {
      continue;
    }
    if (modalities.includes('image')) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Asks the endpoint's own gateway which of its models accept images.
 *
 * @returns model ids that accept image input, or `[]` when the gateway does not
 * say — never throws, because a cosmetic capability hint must not be able to
 * break the endpoints config it rides along with.
 */
export async function fetchVisionCapableModels({
  baseURL,
  apiKey,
}: {
  baseURL?: string;
  apiKey?: string;
}): Promise<string[]> {
  if (!baseURL || !apiKey) {
    return [];
  }

  const cache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = `vision:${baseURL}`;
  try {
    const cached = await cache.get(cacheKey);
    if (Array.isArray(cached)) {
      return cached as string[];
    }
  } catch (error) {
    logger.debug('[fetchVisionCapableModels] cache read failed', error);
  }

  try {
    const { data } = await axios.get(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const ids = extractVisionCapableIds(data);
    /** Only a non-empty answer is worth caching: an empty one means "the gateway
     *  did not tell us", and retrying that in an hour is cheap. */
    if (ids.length > 0) {
      await cache.set(cacheKey, ids, CACHE_TTL);
    }
    return ids;
  } catch (error) {
    logger.debug(
      `[fetchVisionCapableModels] ${baseURL} did not report model capabilities; falling back to name matching`,
      error,
    );
    return [];
  }
}
