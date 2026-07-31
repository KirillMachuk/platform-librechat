import axios from 'axios';
import { probeModel } from './modelProbe';

jest.mock('axios');
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const args = { baseURL: 'http://gateway.internal/v1', apiKey: 'k', model: 'a/model' };

/** An axios rejection, which carries the gateway's answer under `response`. */
const answered = (status: number, data: unknown) =>
  Object.assign(new Error('Request failed'), { response: { status, data } });

/** The words a real gateway used, verbatim. */
const GUARDRAIL = {
  error: {
    message:
      'No endpoints available matching your guardrail restrictions and data policy. ' +
      'Configure: https://openrouter.ai/settings/privacy',
    code: 404,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('probeModel', () => {
  it('sends the smallest request it can and reports no refusal', async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [] } });

    expect(await probeModel(args)).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://gateway.internal/v1/chat/completions',
      expect.objectContaining({ model: 'a/model', max_tokens: 1 }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer k' }) }),
    );
  });

  it('reports the refusal a gateway gives when its data policy rules a model out', async () => {
    mockedAxios.post.mockRejectedValue(answered(404, GUARDRAIL));

    expect(await probeModel(args)).toBe('data-policy');
  });

  it('reads the refusal out of a plain-text answer too', async () => {
    mockedAxios.post.mockRejectedValue(
      answered(404, 'No endpoints available matching your guardrail restrictions'),
    );

    expect(await probeModel(args)).toBe('data-policy');
  });

  /**
   * The status alone is what a mistyped id or a wrong route answers, and neither is
   * a statement about the model being unavailable for good.
   */
  it('does not read every 404 as a policy refusal', async () => {
    mockedAxios.post.mockRejectedValue(
      answered(404, { error: { message: 'a/model is not a valid model ID' } }),
    );

    expect(await probeModel(args)).toBeUndefined();
  });

  /**
   * The text alone can also belong to a refusal aimed at one *message* — "this
   * prompt violates our data policy" — which says nothing about the model and must
   * not stop it being offered.
   */
  it('does not read the words alone as a policy refusal', async () => {
    mockedAxios.post.mockRejectedValue(
      answered(400, { error: { message: 'This prompt violates our data policy' } }),
    );

    expect(await probeModel(args)).toBeUndefined();
  });

  /**
   * The half of the contract that keeps the admin screen usable: everything except
   * a lasting refusal is a reason this minute went badly, not a reason an operator
   * cannot curate the line-up.
   */
  it('reports nothing for the many ways one request can simply fail', async () => {
    const transient = [
      Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }),
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      answered(429, { error: { message: 'Rate limit exceeded' } }),
      answered(402, { error: { message: 'Insufficient credits' } }),
      answered(500, { error: { message: 'Internal Server Error' } }),
      answered(404, undefined),
      answered(404, null),
    ];

    for (const failure of transient) {
      mockedAxios.post.mockRejectedValueOnce(failure);
      expect(await probeModel(args)).toBeUndefined();
    }
  });

  it('does not call an endpoint it has no connection details for', async () => {
    expect(await probeModel({ model: 'a/model' })).toBeUndefined();
    expect(await probeModel({ baseURL: 'http://gw/v1', model: 'a/model' })).toBeUndefined();
    expect(await probeModel({ apiKey: 'k', model: 'a/model' })).toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  /** A hanging gateway must not hold an admin's click open indefinitely. */
  it('caps how long it waits', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await probeModel(args);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    const { timeout } = mockedAxios.post.mock.calls[0][2] as { timeout: number };
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(30_000);
  });
});
