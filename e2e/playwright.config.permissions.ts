import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { getLocalE2EEnv } from './setup/env';

/**
 * A second hermetic run, on its own port and its own database, whose only
 * difference from the mock profile is the `interface` block of its config —
 * the block that seeds role permissions at startup.
 *
 * A whole profile for one thing needs justifying, so: there is no cheaper way
 * to test the gate in this fork. Self-service registration always creates a
 * plain USER (`api/server/services/AuthService.js`), so no test can grant
 * itself `MANAGE_ROLES` and call the roles API; and roles are cached
 * server-side (`CacheKeys.ROLES`), so writing to Mongo behind the server's back
 * changes nothing a page can see. The config is the lever an operator actually
 * pulls, and it is the one this exercises.
 *
 * Runs alongside the mock profile rather than instead of it: different port,
 * different database name, different auth state, different output directory. On
 * CI it is its own job, so the pull-request gate does not get slower.
 */
const rootPath = path.resolve(__dirname, '..');
const serverPath = path.resolve(rootPath, 'e2e/setup/start-server.js');
const fakeModelHookPath = path.resolve(rootPath, 'e2e/setup/fake-model.js');
const configTemplatePath = path.resolve(rootPath, 'e2e/config/librechat.permissions.yaml');
const configPath = path.resolve(rootPath, 'e2e/.generated/librechat.permissions.yaml');
const reportPath = path.resolve(rootPath, 'e2e/playwright-report-permissions');
const storageStatePath = path.resolve(rootPath, 'e2e/storageState.permissions.json');
const runtimeEnvPath = path.resolve(
  rootPath,
  'e2e/specs/.test-results-permissions/runtime-env.json',
);

const baseURL = process.env.E2E_PERMISSIONS_BASE_URL ?? 'http://localhost:3081';
const chromiumChannel = process.env.E2E_CHROMIUM_CHANNEL || undefined;

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, fs.readFileSync(configTemplatePath, 'utf8'));

Object.assign(process.env, {
  ...getLocalE2EEnv(),
  CONFIG_PATH: configPath,
  LIBRECHAT_TEST_RUN_HOOK: fakeModelHookPath,
  TENANT_ISOLATION_STRICT: 'false',
  ALLOW_SOCIAL_LOGIN: 'false',
  ALLOW_SOCIAL_REGISTRATION: 'false',
  /* Its own everything, so the two profiles can run at the same time and
   * neither inherits the other's users, conversations or session. */
  E2E_BASE_URL: baseURL,
  PORT: new URL(baseURL).port,
  MONGO_URI: 'mongodb://127.0.0.1:27017/LibreChat-e2e-permissions',
  E2E_RUNTIME_ENV_PATH: runtimeEnvPath,
  E2E_USER_EMAIL: 'testuser-permissions@example.com',
  E2E_USER_NAME: 'Test User Permissions',
});

export default defineConfig({
  globalSetup: require.resolve('./setup/global-setup'),
  globalTeardown: require.resolve('./setup/global-teardown.mock'),
  testDir: 'specs/permissions/',
  outputDir: 'specs/.test-results-permissions',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { outputFolder: reportPath, open: 'never' }], ['line']]
    : [['html', { outputFolder: reportPath }], ['list']],
  use: {
    baseURL,
    locale: 'en-US',
    video: 'off',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    headless: true,
    storageState: storageStatePath,
    screenshot: 'only-on-failure',
  },
  expect: { timeout: 10000 },
  projects: [
    {
      name: chromiumChannel ?? 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumChannel ? { channel: chromiumChannel } : {}),
      },
    },
  ],
  webServer: [
    {
      command: `node "${serverPath}"`,
      cwd: rootPath,
      url: baseURL,
      stdout: 'pipe',
      ignoreHTTPSErrors: true,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
