const esModules = [
  '@langchain/langgraph',
  '@langchain/langgraph-checkpoint',
  '@langchain/langgraph-sdk',
  'uuid',
].join('|');

export default {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '\\.dev\\.ts$',
    '\\.helper\\.ts$',
    '\\.helper\\.d\\.ts$',
    '/__tests__/helpers/',
    '\\.manual\\.spec\\.[jt]sx?$',
  ],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esModules})/).*/`],
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
    '~/(.*)': '<rootDir>/src/$1',
  },
  // coverageThreshold: {
  //   global: {
  //     statements: 58,
  //     branches: 49,
  //     functions: 50,
  //     lines: 57,
  //   },
  // },
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  maxWorkers: '50%',
  /**
   * Jest reuses a worker across test files, and the heap accumulates inside it.
   * Node's default old-space ceiling is ~2.2 GB, while a full run of this package
   * leaves workers at a median of 967 MB and a p90 of 1507 MB (measured over 282
   * suites) — close enough to the ceiling that V8 spends most of its time
   * collecting. That shows up either as a suite dying outright ("Jest worker ran
   * out of memory and crashed") or, more often, as unrelated suites missing their
   * timeouts: `src/skills/__tests__/import.test.ts` takes 7 s on its own and took
   * 113 s inside a saturated worker, one of its tests blowing the 15 s budget.
   * Recycling the worker keeps every suite in the cheap part of the curve and cut
   * a full run of this package from 973 s to 149 s. Note that lowering `maxWorkers`
   * makes this worse rather than better, because each worker then handles more
   * files and so accumulates more.
   */
  workerIdleMemoryLimit: '1000MB',
  restoreMocks: true,
  testTimeout: 15000,
};
