import { join, resolve } from 'path';
import { readdirSync, readFileSync } from 'fs';
import Russian from './ru/translation.json';
import English from './en/translation.json';

/**
 * Components shipped by `@librechat/client` call `useLocalize` and are rendered
 * inside this app, but the app loads only its own locale resources. A key that
 * exists in the package's locale file and not in this one does not fall back to
 * the package — i18next renders the key itself. The file table announced its
 * search field to screen readers as "com_ui_search_table" for as long as that
 * was true of nine keys.
 *
 * Missing from Russian is a quieter version of the same thing: `fallbackLng`
 * resolves to English, so a Russian-speaking user gets an English string in a
 * Russian interface and nothing anywhere says so. Those same nine keys reached
 * `ru` only because unrelated pull requests happened to add them.
 *
 * Only literal `localize('com_…')` calls are found this way; keys passed
 * through a variable cannot be resolved without running the app, and are the
 * e2e suite's job.
 */
const PACKAGE_SOURCE = resolve(__dirname, '..', '..', '..', 'packages', 'client', 'src');

/**
 * All three quote forms. The single-quote-only version of this pattern could
 * not see localize(`com_ui_select_row`) in DataTable.tsx at all: a guard that
 * recognises one way of writing a call is blind to exactly the keys written the
 * other way, which is the defect class it exists to catch.
 */
const LOCALIZE_CALL = /localize\(\s*['"`](com_[a-z0-9_]+)['"`]/g;
const IS_TEST = /\.(spec|test)\.tsx?$/;

/**
 * Block comments and whole-line `//` comments only. Stripping every `//` to
 * end of line would eat the rest of a line that holds a URL in a string,
 * taking a real `localize` call with it — going blind to avoid a false alarm.
 * The sentinels below fail if this ever does.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const collectKeys = (): Set<string> => {
  const keys = new Set<string>();
  const entries = readdirSync(PACKAGE_SOURCE, { recursive: true, encoding: 'utf8' });
  for (const entry of entries) {
    if (!/\.tsx?$/.test(entry) || IS_TEST.test(entry) || entry.includes('locales')) {
      continue;
    }
    const source = stripComments(readFileSync(join(PACKAGE_SOURCE, entry), 'utf8'));
    for (const match of source.matchAll(LOCALIZE_CALL)) {
      keys.add(match[1]);
    }
  }
  return keys;
};

const undefinedIn = (locale: Record<string, string>): string[] =>
  [...collectKeys()].filter((key) => locale[key] == null || locale[key] === '').sort();

describe('shared component translations', () => {
  /**
   * A scan that quietly stopped finding things would make every assertion below
   * pass forever. Counting is a weak way to prove it did not: the scan found 26
   * keys while blind to backticks, and could lose most of them and still clear
   * a threshold. So it has to produce two keys by name, one written each way.
   */
  it('finds the keys the shared components ask for, in every quote form', () => {
    const keys = collectKeys();
    /* DataTableSearch.tsx, single quotes — the key the file table used to read
     * aloud to screen readers. DataTable.tsx, backticks. */
    expect([...keys].sort()).toEqual(
      expect.arrayContaining(['com_ui_search_table', 'com_ui_select_row']),
    );
    expect(keys.size).toBeGreaterThan(20);
  });

  it('defines every one of them in this app', () => {
    expect(undefinedIn(English as Record<string, string>)).toEqual([]);
  });

  it('defines every one of them in Russian too', () => {
    expect(undefinedIn(Russian as Record<string, string>)).toEqual([]);
  });
});
