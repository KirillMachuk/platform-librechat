import { readPreferencesPayload, toPreferencesRecord } from './preferences';

describe('toPreferencesRecord', () => {
  it('flattens the Map a hydrated document carries', () => {
    const raw = new Map([
      ['autoScroll', 'true'],
      ['color-theme', 'dark'],
    ]);
    expect(toPreferencesRecord(raw)).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });

  it('passes through the plain object a lean query returns', () => {
    expect(toPreferencesRecord({ autoScroll: 'false' })).toEqual({ autoScroll: 'false' });
  });

  it('treats an account that has never saved anything as empty', () => {
    expect(toPreferencesRecord(undefined)).toEqual({});
    expect(toPreferencesRecord(null)).toEqual({});
    expect(toPreferencesRecord(new Map())).toEqual({});
  });
});

describe('readPreferencesPayload', () => {
  it('accepts the settings it recognises', () => {
    const result = readPreferencesPayload({ preferences: { autoScroll: 'true' } });
    expect(result).toEqual({ preferences: { autoScroll: 'true' }, rejected: [] });
  });

  it('reports what it dropped instead of failing the whole call', () => {
    const result = readPreferencesPayload({
      preferences: { autoScroll: 'true', mystery: 'true', decibelValue: 'loud' },
    });
    expect(result?.preferences).toEqual({ autoScroll: 'true' });
    expect(result?.rejected.sort()).toEqual(['decibelValue', 'mystery']);
  });

  it('rejects a body that is not carrying a preferences object', () => {
    expect(readPreferencesPayload(null)).toBeNull();
    expect(readPreferencesPayload({})).toBeNull();
    expect(readPreferencesPayload({ preferences: null })).toBeNull();
    expect(readPreferencesPayload({ preferences: 'autoScroll=true' })).toBeNull();
    expect(readPreferencesPayload({ preferences: [] })).toBeNull();
  });

  it('accepts an empty object as "nothing to change"', () => {
    expect(readPreferencesPayload({ preferences: {} })).toEqual({ preferences: {}, rejected: [] });
  });
});
