/** v0.8.7-rc1 */
module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:3080',
  },
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!<rootDir>/node_modules/',
    '!src/**/*.css.d.ts',
    '!src/**/*.d.ts',
  ],
  coveragePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/test/setupTests.js'],
  //  Todo: Add coverageThreshold once we have enough coverage
  //  Note: eventually we want to have these values set to 80%
  // coverageThreshold: {
  //   global: {
  //     functions: 9,
  //     lines: 40,
  //     statements: 40,
  //     branches: 12,
  //   },
  // },
  moduleNameMapper: {
    '\\.(css)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      'jest-file-loader',
    '^test/(.*)$': '<rootDir>/test/$1',
    '^~/(.*)$': '<rootDir>/src/$1',
    /**
     * Source, not `dist` — see packages/api/jest.config.mjs for why, and
     * `scripts/check-shared-source.mjs` for the guard that keeps it that way.
     * Reached by relative path rather than through `node_modules`, whose symlink
     * resolves to the primary checkout: a worktree was reading whichever branch
     * that checkout happened to be on.
     */
    '^librechat-data-provider/react-query$':
      '<rootDir>/../packages/data-provider/src/react-query',
    '^librechat-data-provider$': '<rootDir>/../packages/data-provider/src/index.ts',
  },
  maxWorkers: '50%',
  /**
   * Recycle a worker once its heap passes this mark — see the comment in
   * `packages/api/jest.config.mjs`. Without it, workers drift towards Node's
   * ~2.2 GB old-space ceiling and whichever suite lands on a saturated worker
   * either dies or misses its timeouts.
   */
  workerIdleMemoryLimit: '1000MB',
  restoreMocks: true,
  testResultsProcessor: 'jest-junit',
  coverageReporters: ['text', 'cobertura', 'lcov'],
  transform: {
    '\\.[jt]sx?$': 'babel-jest',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      'jest-file-loader',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@zattoo/use-double-click|@dicebear|@react-dnd|react-dnd.*|dnd-core|filenamify|filename-reserved-regex|heic-to|lowlight|highlight\\.js|fault|react-markdown|unified|bail|trough|devlop|is-.*|parse-entities|stringify-entities|character-.*|trim-lines|style-to-object|inline-style-parser|html-url-attributes|escape-string-regexp|longest-streak|zwitch|ccount|markdown-table|comma-separated-tokens|space-separated-tokens|web-namespaces|property-information|remark-.*|rehype-.*|recma-.*|hast.*|mdast-.*|unist-.*|vfile.*|micromark.*|estree-util-.*|decode-named-character-reference)/)/',
  ],
  setupFilesAfterEnv: ['@testing-library/jest-dom/extend-expect', '<rootDir>/test/setupTests.js'],
  clearMocks: true,
};
