export default {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/misc/'],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    /** Source, not `dist` — see packages/api/jest.config.mjs for why, and
     *  `scripts/check-shared-source.mjs` for the guard that keeps it that way. */
    '^librechat-data-provider$': '<rootDir>/../data-provider/src/index.ts',
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
};
