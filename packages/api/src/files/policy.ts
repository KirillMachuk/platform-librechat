import { logger } from '@librechat/data-schemas';

/** What the anonymizer says should happen to an image attachment. */
export interface AttachmentPolicy {
  /** Read the image and send the model its text instead of the picture. */
  imagesToText: boolean;
}

/**
 * Default when the anonymizer cannot be reached: read the text.
 *
 * Erring towards reading keeps a picture the platform could have read from
 * leaving the perimeter unmasked, and it is what every deployment that has this
 * feature on already does. The opposite default would turn a network blip into
 * a quiet privacy downgrade.
 */
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = { imagesToText: true };

/** Just the slice of `fetch` this reader uses, so a test can stand in for it
 * without restating the whole DOM signature. `fetch` itself satisfies it. */
export type PolicyFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const POLICY_TIMEOUT_MS = 2_000;
const POLICY_TTL_MS = 60_000;
/** While the anonymizer is down, retry at most this often — otherwise every
 * upload pays the timeout again. */
const POLICY_RETRY_MS = 10_000;

let cached: { policy: AttachmentPolicy; expiresAt: number } | null = null;
let warned = false;

/** Test seam: drops the memoised policy so a case starts from a known state. */
export const resetAttachmentPolicyCache = (): void => {
  cached = null;
  warned = false;
};

const readEnv = (env: NodeJS.ProcessEnv) => ({
  url: env.ANON_POLICY_URL || 'http://anonymizer:8000/v1/policy/attachments',
  token: env.ANON_CLIENT_TOKEN ?? '',
});

/**
 * Ask the anonymizer whether images should be read into text. Cached for a
 * minute: the answer changes when an administrator changes it, not per upload,
 * and an upload must not wait on a second service more often than that.
 *
 * Never throws and never blocks an upload for longer than {@link POLICY_TIMEOUT_MS}
 * — a failure here degrades to {@link DEFAULT_ATTACHMENT_POLICY}, and the last
 * good answer is preferred over the default while it is still fresh.
 */
export const getAttachmentPolicy = async (
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: PolicyFetch = fetch,
): Promise<AttachmentPolicy> => {
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.policy;
  }
  const { url, token } = readEnv(env);
  try {
    const response = await fetchImpl(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`responded ${response.status}`);
    }
    const body = (await response.json()) as { images_to_text?: boolean };
    if (typeof body.images_to_text !== 'boolean') {
      throw new Error('no images_to_text in response');
    }
    cached = { policy: { imagesToText: body.images_to_text }, expiresAt: now + POLICY_TTL_MS };
    warned = false;
    return cached.policy;
  } catch (error) {
    if (!warned) {
      warned = true;
      logger.warn(
        `[attachmentPolicy] could not read the anonymizer policy at ${url}, ` +
          `falling back to reading images as text: ${(error as Error).message}`,
      );
    }
    const policy = cached?.policy ?? DEFAULT_ATTACHMENT_POLICY;
    cached = { policy, expiresAt: now + POLICY_RETRY_MS };
    return policy;
  }
};
