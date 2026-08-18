export default {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  /**
   * Refuses to start when the workspace packages jest would load are not this
   * checkout's — a worktree borrowing `node_modules` from another checkout tests
   * that checkout's branch. `WORKSPACE_BUILD_WARN_ONLY=1` downgrades it to a
   * banner; exempt only under GitHub Actions, which builds its own every run.
   */
  globalSetup: '<rootDir>/../../scripts/jest-workspace-build.cjs',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
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
  testTimeout: 15000,
  // React component testing requires jsdom environment
  testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'http://localhost:3080' },
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!(@tanstack|lucide-react|@dicebear)/)'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
