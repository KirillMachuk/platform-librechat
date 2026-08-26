const { devices } = require('@playwright/test');
const base = require('../../e2e/playwright.config.mock').default;

/** The mock stack, driven by both engines, over this folder only — never by CI. */
module.exports = {
  ...base,
  testDir: __dirname,
  outputDir: '/tmp/export-probe-results',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
};
