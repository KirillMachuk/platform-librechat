module.exports = {
  /**
   * Refuses to start when the workspace packages jest would load are not this
   * checkout's — a worktree borrowing `node_modules` from another checkout tests
   * that checkout's branch. `WORKSPACE_BUILD_WARN_ONLY=1` downgrades it to a
   * banner; exempt only under GitHub Actions, which builds its own every run.
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
