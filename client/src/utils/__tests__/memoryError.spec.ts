import { memoryErrorKey } from '../memoryError';

describe('memoryErrorKey', () => {
  it('localizes a refusal instead of showing the server sentence', () => {
    expect(
      memoryErrorKey({
        status: 422,
        data: { error: 'Value looks like personal data.', errorType: 'personal_data' },
      }),
    ).toBe('com_ui_memory_personal_data');
  });

  it('localizes an unavailable guard', () => {
    expect(
      memoryErrorKey({
        status: 503,
        data: {
          error: 'Memory guard is unavailable, try again shortly.',
          errorType: 'guard_unavailable',
        },
      }),
    ).toBe('com_ui_memory_guard_unavailable');
  });

  it('keeps recognising the errors that predate errorType', () => {
    expect(
      memoryErrorKey({ status: 409, data: { error: 'Memory with this key already exists.' } }),
    ).toBe('com_ui_memory_key_exists');
    expect(
      memoryErrorKey({
        status: 400,
        data: { error: 'Key must only contain lowercase letters and underscores' },
      }),
    ).toBe('com_ui_memory_key_validation');
  });

  it('says nothing about errors it does not recognise, so the caller can fall back', () => {
    expect(memoryErrorKey({ status: 500, data: { error: 'Boom' } })).toBeUndefined();
    expect(memoryErrorKey(undefined)).toBeUndefined();
  });
});
