import { writeStoredValue } from './storage';

describe('writeStoredValue', () => {
  beforeEach(() => localStorage.clear());

  it('stores the value', () => {
    writeStoredValue('autoScroll', 'true');
    expect(localStorage.getItem('autoScroll')).toBe('true');
  });

  it('tells this tab about the write, which the browser itself never does', () => {
    const seen: Array<{ key: string | null; newValue: string | null }> = [];
    const listener = (event: StorageEvent) =>
      seen.push({ key: event.key, newValue: event.newValue });
    window.addEventListener('storage', listener);

    writeStoredValue('color-theme', 'dark');

    window.removeEventListener('storage', listener);
    expect(seen).toEqual([{ key: 'color-theme', newValue: 'dark' }]);
  });

  it('stays quiet when the value could not be stored', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const listener = jest.fn();
    window.addEventListener('storage', listener);

    expect(() => writeStoredValue('autoScroll', 'true')).not.toThrow();

    window.removeEventListener('storage', listener);
    expect(listener).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
