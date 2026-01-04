/**
 * Test Setup
 *
 * This file runs before all tests. It:
 * - Loads environment variables
 * - Validates database connection
 * - Handles global cleanup
 */

require('dotenv').config();

// Ensure we have a database URL for testing
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required for tests');
  console.error('Set it in a .env file or export it before running tests');
  process.exit(1);
}

// Suppress console.log during tests (comment out for debugging)
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  if (process.env.VERBOSE_TESTS !== 'true') {
    console.log = jest.fn();
  }
});

afterAll(async () => {
  console.log = originalLog;
  console.error = originalError;

  // Close the database pool after all tests
  const { pool } = require('../server');
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
});

// Global test timeout
jest.setTimeout(30000);
