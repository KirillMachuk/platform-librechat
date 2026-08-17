module.exports = {
  /**
   * Fails loudly when the workspace packages jest is about to load are not the
   * ones in this checkout — a worktree borrowing `node_modules` from another
   * checkout tests that checkout's branch. Warns by default, stops under
   * `STRICT_WORKSPACE_BUILD=1`, silent in CI, which builds its own.
   */
  globalSetup: '<rootDir>/../../scripts/jest-workspace-build.cjs',
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
  },
  // coverageThreshold: {
  //   global: {
  //     statements: 58,
  //     branches: 49,
  //     functions: 50,
  //     lines: 57,
  //   },
  // },
  maxWorkers: '50%',
  /** Recycle a worker once its heap passes this mark — see `packages/api/jest.config.mjs`. */
  workerIdleMemoryLimit: '1000MB',
  restoreMocks: true,
};
