const libraryAliases = {
  '^@posts-media/configuration$': '<rootDir>/libs/configuration/src/index.ts',
  '^@posts-media/database$': '<rootDir>/libs/database/src/index.ts',
  '^@posts-media/domain$': '<rootDir>/libs/domain/src/index.ts',
  '^@posts-media/posts$': '<rootDir>/libs/posts/src/index.ts',
  '^@posts-media/media$': '<rootDir>/libs/media/src/index.ts',
  '^@posts-media/storage$': '<rootDir>/libs/storage/src/index.ts',
  '^@posts-media/queues$': '<rootDir>/libs/queues/src/index.ts',
  '^@posts-media/media-processing$':
    '<rootDir>/libs/media-processing/src/index.ts',
  '^@posts-media/observability$': '<rootDir>/libs/observability/src/index.ts',
  '^@posts-media/testing$': '<rootDir>/libs/testing/src/index.ts',
};

const project = (displayName, testMatch, testPathIgnorePatterns = []) => ({
  displayName,
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testMatch,
  testPathIgnorePatterns,
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: libraryAliases,
});

module.exports = {
  projects: [
    project(
      'unit',
      ['<rootDir>/libs/**/*.spec.ts', '<rootDir>/apps/api/**/*.spec.ts'],
      ['\\.integration\\.spec\\.ts$'],
    ),
    project('integration', [
      '<rootDir>/libs/**/*.integration.spec.ts',
      '<rootDir>/test/integration/**/*.spec.ts',
    ]),
    project('e2e', ['<rootDir>/test/e2e/**/*.e2e-spec.ts']),
    project('worker', ['<rootDir>/apps/worker/**/*.spec.ts']),
  ],
};
