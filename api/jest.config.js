const esModules = [
  'openid-client',
  'oauth4webapi',
  'jose',
  '@langchain/langgraph',
  '@langchain/langgraph-checkpoint',
  '@langchain/langgraph-sdk',
  'uuid',
].join('|');

module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  roots: ['<rootDir>'],
  coverageDirectory: 'coverage',
  maxWorkers: '50%',
  /**
   * Recycle a worker once its heap passes this mark. Jest reuses a worker across
   * test files and the heap accumulates inside it; once a worker approaches Node's
   * ~2.2 GB old-space ceiling, V8 spends its time collecting, so suites either die
   * outright ("Jest worker ran out of memory and crashed") or miss their timeouts
   * for no reason of their own. Lowering `maxWorkers` makes it worse, since each
   * worker then handles more files. See `packages/api/jest.config.mjs` for the
   * measured numbers behind the value.
   */
  workerIdleMemoryLimit: '1000MB',
  testTimeout: 30000, // 30 seconds timeout for all tests
  setupFiles: ['./test/jestSetup.js', './test/__mocks__/logger.js'],
  /**
   * Fails loudly when the workspace packages jest is about to load are not the
   * ones in this checkout — a worktree borrowing `node_modules` from another
   * checkout tests that checkout's branch. Warns by default, stops under
   * `STRICT_WORKSPACE_BUILD=1`, silent in CI, which builds its own.
   */
  globalSetup: '<rootDir>/../scripts/jest-workspace-build.cjs',
  moduleNameMapper: {
    '~/(.*)': '<rootDir>/$1',
    '~/data/auth.json': '<rootDir>/__mocks__/auth.mock.json',
    '^openid-client/passport$': '<rootDir>/test/__mocks__/openid-client-passport.js',
    '^openid-client$': '<rootDir>/test/__mocks__/openid-client.js',
  },
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esModules})/).*/`],
};
