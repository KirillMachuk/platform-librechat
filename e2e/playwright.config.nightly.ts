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

/* CI runs the runner's preinstalled Google Chrome and skips the bundled browser
 * download, so a project that does not carry the channel launches nothing. The
 * mock config applies this to its one project; overriding `projects` here drops
 * it, which is how the first nightly run failed with "Executable doesn't exist". */
const chrome = process.env.E2E_CHROMIUM_CHANNEL
  ? { ...devices['Desktop Chrome'], channel: process.env.E2E_CHROMIUM_CHANNEL }
  : devices['Desktop Chrome'];

export default defineConfig({
  ...mockConfig,
  testDir: 'specs/nightly/',
  projects: [
    {
      name: 'desktop',
      testMatch: LAYOUT,
      use: { ...chrome },
    },
    {
      /** The client reads Russian; a smoke on English only would never see it. */
      name: 'desktop-ru',
      testMatch: /(layout|locale)\.spec\.ts/,
      use: { ...chrome, locale: 'ru-RU' },
    },
    {
      name: 'dark',
      testMatch: /(layout|theme)\.spec\.ts/,
      use: { ...chrome, colorScheme: 'dark' },
    },
    {
      name: 'phone',
      testMatch: LAYOUT,
      use: { ...chrome, viewport: { width: 414, height: 896 } },
    },
    {
      /**
       * A desktop narrow enough that the sidebar and the work area compete for
       * room, but wide enough that neither switches to its phone layout. This
       * width was originally chosen for the band where the artifacts panel and
       * its layout host disagreed — the panel went to its phone sheet at 868px
       * while the host kept the desktop split until 767px. Both read 767.98px
       * since the redesign, so the disagreement is gone and this project now
       * earns its keep as plain narrow-desktop coverage.
       */
      name: 'narrow-desktop',
      testMatch: LAYOUT,
      use: { ...chrome, viewport: { width: 800, height: 900 } },
    },
  ],
});
