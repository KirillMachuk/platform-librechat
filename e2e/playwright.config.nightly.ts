import { defineConfig, devices } from '@playwright/test';
import mockConfig from './playwright.config.mock';

/**
 * The nightly profile: the same hermetic server as the PR gate, run against the
 * viewports, themes and locale the PR gate does not have time for.
 *
 * It is deliberately a separate `testDir`. Multiplying the whole mock suite by
 * four projects would quadruple the gate every contributor waits on, to catch
 * things that only need catching once a day.
 */
/* Which specs a project runs is expressed here rather than as a skip inside
 * each test: a skipped test still spends a worker slot and still reports, and
 * five projects × every spec is four times the work for nothing. */
const LAYOUT = /layout\.spec\.ts/;

export default defineConfig({
  ...mockConfig,
  testDir: 'specs/nightly/',
  projects: [
    {
      name: 'desktop',
      testMatch: LAYOUT,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /** The client reads Russian; a smoke on English only would never see it. */
      name: 'desktop-ru',
      testMatch: /(layout|locale)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], locale: 'ru-RU' },
    },
    {
      name: 'dark',
      testMatch: /(layout|theme)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'phone',
      testMatch: LAYOUT,
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 } },
    },
    {
      /**
       * The band where the artifacts panel and its layout host disagree: the
       * panel switches to its phone sheet at 868px while the host keeps the
       * desktop split until 767px. Nothing else looks at these widths.
       */
      name: 'narrow-desktop',
      testMatch: LAYOUT,
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 900 } },
    },
  ],
});
