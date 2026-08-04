import axios from 'axios';
import { MEMORY_GUARD_TOKEN_ENV, MEMORY_GUARD_URL_ENV } from '@librechat/data-schemas';
import { checkMemoryValue } from './guard';

jest.mock('axios');
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const GUARD_URL = 'http://guard.test/v1/classify';

describe('checkMemoryValue', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env[MEMORY_GUARD_URL_ENV] = GUARD_URL;
    delete process.env[MEMORY_GUARD_TOKEN_ENV];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows a working-profile value the guard finds nothing in', async () => {
    mockedPost.mockResolvedValue({ data: { count: 0, types: [] } });

    const verdict = await checkMemoryValue('Lease lawyer, prefers answers as tables');

    expect(verdict).toEqual({ outcome: 'allowed' });
    expect(mockedPost).toHaveBeenCalledWith(
      GUARD_URL,
      { text: 'Lease lawyer, prefers answers as tables' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('rejects a value carrying personal data and reports types, never values', async () => {
    mockedPost.mockResolvedValue({ data: { count: 2, types: ['PERSON', 'PHONE'] } });

    const verdict = await checkMemoryValue('Client Ivan Petrov, +375291234567');

    expect(verdict).toEqual({ outcome: 'rejected', types: ['PERSON', 'PHONE'] });
  });

  it('fails closed when the guard is unreachable', async () => {
    mockedPost.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(checkMemoryValue('anything')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('fails closed when the guard answers in an unexpected shape', async () => {
    mockedPost.mockResolvedValue({ data: { unexpected: true } });

    await expect(checkMemoryValue('anything')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('fails closed when no guard is configured, without calling anything', async () => {
    delete process.env[MEMORY_GUARD_URL_ENV];

    await expect(checkMemoryValue('anything')).resolves.toEqual({ outcome: 'unavailable' });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('presents the configured token to the guard', async () => {
    process.env[MEMORY_GUARD_TOKEN_ENV] = 'secret-token';
    mockedPost.mockResolvedValue({ data: { count: 0, types: [] } });

    await checkMemoryValue('Lease lawyer');

    expect(mockedPost).toHaveBeenCalledWith(
      GUARD_URL,
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: 'Bearer secret-token' } }),
    );
  });
});
