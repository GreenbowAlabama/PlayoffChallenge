module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['./tests/setup.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverageFrom: [
    'server.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  // Prevent tests from running in parallel (DB conflicts)
  maxWorkers: 1
};
