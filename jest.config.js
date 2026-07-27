module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.eslint.json',
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup.ts'],
};
