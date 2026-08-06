import {
  getAttachmentPolicy,
  DEFAULT_ATTACHMENT_POLICY,
  resetAttachmentPolicyCache,
} from './policy';

const env = { ANON_POLICY_URL: 'http://anon/v1/policy/attachments', ANON_CLIENT_TOKEN: 'tok' };

const answering = (body: unknown, ok = true) =>
  jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body });

describe('getAttachmentPolicy', () => {
  beforeEach(() => {
    resetAttachmentPolicyCache();
    jest.useRealTimers();
  });

  it('reads the anonymizer answer', async () => {
    const fetchImpl = answering({ images_to_text: false });

    await expect(getAttachmentPolicy(env, fetchImpl)).resolves.toEqual({ imagesToText: false });
  });

  it('presents the client token the anonymizer expects', async () => {
    const fetchImpl = answering({ images_to_text: true });

    await getAttachmentPolicy(env, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      env.ANON_POLICY_URL,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('asks once per minute, not once per upload', async () => {
    const fetchImpl = answering({ images_to_text: false });

    await getAttachmentPolicy(env, fetchImpl);
    await getAttachmentPolicy(env, fetchImpl);
    await getAttachmentPolicy(env, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /**
   * A network blip must not quietly downgrade privacy: with no answer the
   * platform keeps reading images rather than letting pictures through raw.
   */
  it('falls back to reading the text when the anonymizer cannot be reached', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getAttachmentPolicy(env, fetchImpl)).resolves.toEqual(DEFAULT_ATTACHMENT_POLICY);
    expect(DEFAULT_ATTACHMENT_POLICY.imagesToText).toBe(true);
  });

  it('treats a non-2xx and a malformed body as no answer', async () => {
    await expect(getAttachmentPolicy(env, answering({}, false))).resolves.toEqual(
      DEFAULT_ATTACHMENT_POLICY,
    );
    resetAttachmentPolicyCache();
    await expect(getAttachmentPolicy(env, answering({ images_to_text: 'yes' }))).resolves.toEqual(
      DEFAULT_ATTACHMENT_POLICY,
    );
  });

  /**
   * The last good answer outranks the default while the service is away —
   * an administrator who turned reading OFF should not have it turned back on
   * by an unrelated outage.
   */
  it('keeps the last answer through an outage instead of reverting to the default', async () => {
    await getAttachmentPolicy(env, answering({ images_to_text: false }));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);

    const failing = jest.fn().mockRejectedValue(new Error('down'));
    await expect(getAttachmentPolicy(env, failing)).resolves.toEqual({ imagesToText: false });
    expect(failing).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockRestore();
  });

  it('backs off between retries while the anonymizer is down', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('down'));

    await getAttachmentPolicy(env, failing);
    await getAttachmentPolicy(env, failing);

    expect(failing).toHaveBeenCalledTimes(1);
  });

  /**
   * Reusing a recent answer is standing in for the service; reusing an old one is
   * guessing. A remembered `false` used to survive an outage of any length, because
   * every failed retry re-extended it — so a long outage sent every picture to the
   * provider un-read, the less private direction, for as long as it lasted.
   */
  it('stops reusing the last answer once it is too old to stand for anything', async () => {
    const start = Date.now();
    await getAttachmentPolicy(env, answering({ images_to_text: false }));
    const failing = jest.fn().mockRejectedValue(new Error('down'));

    jest.spyOn(Date, 'now').mockReturnValue(start + 120_000);
    await expect(getAttachmentPolicy(env, failing)).resolves.toEqual({ imagesToText: false });

    jest.spyOn(Date, 'now').mockReturnValue(start + 3_600_000);
    await expect(getAttachmentPolicy(env, failing)).resolves.toEqual(DEFAULT_ATTACHMENT_POLICY);

    jest.spyOn(Date, 'now').mockRestore();
  });

  /** A recovered service replaces the remembered answer rather than ageing beside it. */
  it('takes a fresh answer over a remembered one when the service returns', async () => {
    const start = Date.now();
    await getAttachmentPolicy(env, answering({ images_to_text: false }));

    jest.spyOn(Date, 'now').mockReturnValue(start + 120_000);
    await expect(getAttachmentPolicy(env, answering({ images_to_text: true }))).resolves.toEqual({
      imagesToText: true,
    });

    jest.spyOn(Date, 'now').mockReturnValue(start + 3_600_000);
    const failing = jest.fn().mockRejectedValue(new Error('down'));
    await expect(getAttachmentPolicy(env, failing)).resolves.toEqual({ imagesToText: true });

    jest.spyOn(Date, 'now').mockRestore();
  });
});
