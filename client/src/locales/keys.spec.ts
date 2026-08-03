import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import English from './en/translation.json';

/**
 * Components shipped by `@librechat/client` call `useLocalize` and are rendered
 * inside this app, but the app loads only its own locale resources. A key that
 * exists in the package's locale file and not in this one does not fall back to
 * the package — i18next renders the key itself. The file table announced its
 * search field to screen readers as "com_ui_search_table" for as long as that
 * was true of nine keys.
 *
 * Only literal `localize('com_…')` calls are found this way; keys passed
 * through a variable cannot be resolved without running the app, and are the
 * e2e suite's job.
 */
const PACKAGE_SOURCE = resolve(__dirname, '..', '..', '..', 'packages', 'client', 'src');
const LOCALIZE_CALL = /localize\(\s*'(com_[a-z0-9_]+)'/g;
const IS_TEST = /\.(spec|test)\.tsx?$/;

const collectKeys = (): Set<string> => {
  const keys = new Set<string>();
  const entries = readdirSync(PACKAGE_SOURCE, { recursive: true, encoding: 'utf8' });
  for (const entry of entries) {
    if (!/\.tsx?$/.test(entry) || IS_TEST.test(entry) || entry.includes('locales')) {
      continue;
    }
    const source = readFileSync(join(PACKAGE_SOURCE, entry), 'utf8');
    for (const match of source.matchAll(LOCALIZE_CALL)) {
      keys.add(match[1]);
    }
  }
  return keys;
};

describe('shared component translations', () => {
  /* A scan that silently found nothing would make the assertion below pass
   * forever, so the scan proves itself first. */
  it('finds the keys the shared components ask for', () => {
    expect(collectKeys().size).toBeGreaterThan(10);
  });

  it('defines every one of them in this app', () => {
    const defined = English as Record<string, string>;
    const missing = [...collectKeys()].filter((key) => defined[key] == null).sort();
    expect(missing).toEqual([]);
  });
});
