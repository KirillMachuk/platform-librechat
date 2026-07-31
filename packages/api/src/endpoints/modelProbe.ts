import axios from 'axios';
import { logger } from '@librechat/data-schemas';

/**
 * Asks a gateway whether it will actually serve a model, by asking it to.
 *
 * A catalogue lists what a gateway knows about, which is not the same as what it
 * will answer with. An account's privacy settings can rule out every provider
 * serving a particular model, and the catalogue says nothing about that — the
 * refusal only appears when someone sends a message. So an admin switches a model
 * on, it looks fine, and the first employee to pick it gets an error.
 *
 * One token is enough to find out, and the answer is worth far more than it costs.
 */

/**
 * Why a gateway will not serve a model at all — as opposed to the many reasons one
 * request might fail. Only refusals that will still be refusals tomorrow belong
 * here.
 */
export type ModelRefusal = 'data-policy';

/**
 * Long enough for a cold provider, short enough that an admin does not think the
 * screen has hung. The caller treats a timeout as "no refusal", so erring long
 * only costs the wait.
 */
const PROBE_TIMEOUT_MS = 15_000;

/** Nothing is generated; the gateway decides whether it will serve before it answers. */
const PROBE_MAX_TOKENS = 1;

/**
 * The gateway's own words for "your account's data policy rules out every provider
 * that serves this model" — OpenRouter-shaped gateways answer 404 with this.
 *
 * Both halves are required. The text alone would also match a refusal aimed at one
 * *message* ("this prompt violates our data policy"), which says nothing about the
 * model and must not stop it being offered; the status alone is what an unknown
 * model or a mistyped route returns.
 */
const DATA_POLICY_MESSAGE = /guardrail|data policy/i;
const DATA_POLICY_STATUS = 404;

/**
 * Whether a gateway's answer is the "your data policy rules this model out"
 * refusal.
 *
 * Exported because two places have to recognise the same thing and must not drift
 * apart: this probe, deciding whether to let a model be offered, and the chat,
 * deciding what to tell an employee who picked one that already was. Callers dig
 * the status and the text out of whatever error shape reaches them — an axios
 * rejection here, an SDK error there — and hand over just those two.
 */
export function isDataPolicyRefusal(status: unknown, text: string): boolean {
  return status === DATA_POLICY_STATUS && DATA_POLICY_MESSAGE.test(text);
}

/** Everything a gateway might put an error message in, flattened to one string. */
function messageOf(error: unknown): string {
  const response = (error as { response?: { data?: unknown } } | null)?.response;
  if (response?.data == null) {
    return '';
  }
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
}

function refusalOf(error: unknown): ModelRefusal | undefined {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return isDataPolicyRefusal(status, messageOf(error)) ? 'data-policy' : undefined;
}

/**
 * Sends the smallest possible request and reports only a refusal that will outlive
 * it.
 *
 * Deliberately one-directional: anything else — a timeout, a gateway that is down,
 * a rate limit, an out-of-credit account, a model that dislikes a one-token
 * ceiling — answers `undefined`. Those are all reasons this minute went badly, and
 * none of them is a reason an operator should be unable to curate the line-up. The
 * cost of being wrong that way is one model that fails when it is picked, which is
 * exactly where we started; the cost of being wrong the other way is an admin
 * screen that stops working whenever the gateway hiccups.
 */
export async function probeModel({
  baseURL,
  apiKey,
  model,
}: {
  baseURL?: string;
  apiKey?: string;
  model: string;
}): Promise<ModelRefusal | undefined> {
  if (!baseURL || !apiKey) {
    return undefined;
  }
  try {
    await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: PROBE_MAX_TOKENS,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    return undefined;
  } catch (error) {
    const refusal = refusalOf(error);
    logger.debug(
      `[probeModel] ${model}: ${refusal ?? 'no lasting refusal'} (${messageOf(error).slice(0, 200)})`,
    );
    return refusal;
  }
}
