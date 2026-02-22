/**
 * Test Setup
 *
 * This file runs before all tests. It:
 * - Loads environment variables
 * - Validates database connection
 * - Handles global cleanup
 */

require('dotenv').config();

// Map DATABASE_URL to DATABASE_URL_TEST in test environment
// This ensures all code that reads DATABASE_URL (including server.js) uses the test DB
if (process.env.NODE_ENV === 'test') {
  if (!process.env.DATABASE_URL_TEST) {
    console.error('FATAL: DATABASE_URL_TEST required in test environment');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// CRITICAL SAFETY GUARD: Use test database only, never staging/prod
if (!process.env.DATABASE_URL_TEST) {
  console.error('FATAL: DATABASE_URL_TEST environment variable is required for integration tests');
  console.error('Set DATABASE_URL_TEST in .env file');
  console.error('Example: DATABASE_URL_TEST=postgresql://user:pass@host:port/test_database');
  process.exit(1);
}

// Verify test database URL is valid
if (!process.env.DATABASE_URL_TEST.startsWith('postgresql://')) {
  console.error('FATAL: DATABASE_URL_TEST must be a valid PostgreSQL connection string');
  console.error('Expected format: postgresql://user:password@host:port/database');
  process.exit(1);
}

// Verify test database name exists and check explicit opt-in for non-standard names
let dbName;
try {
  const testUrl = new URL(process.env.DATABASE_URL_TEST);
  dbName = testUrl.pathname.split('/')[1];
  if (!dbName) {
    console.error('FATAL: Could not determine test database name from DATABASE_URL_TEST');
    process.exit(1);
  }
} catch (err) {
  console.error('FATAL: Could not parse DATABASE_URL_TEST');
  console.error('Error:', err.message);
  process.exit(1);
}

// CRITICAL: Enforce explicit opt-in for databases that don't contain "test" in the name
// This is Railway-safe (allows "railway" dbName) but production-safe (requires explicit opt-in)
const hasTestInName = dbName.toLowerCase().includes('test');
const explicitlyAllowed = process.env.TEST_DB_ALLOW_DBNAME === dbName;

if (!hasTestInName && !explicitlyAllowed) {
  console.error('FATAL: Test database name does not contain "test" and explicit opt-in is not set');
  console.error(`Database name: ${dbName}`);
  console.error(`To use this database, set: TEST_DB_ALLOW_DBNAME=${dbName}`);
  console.error(`Example: TEST_DB_ALLOW_DBNAME=${dbName} npm test`);
  process.exit(1);
}

if (!hasTestInName && explicitlyAllowed) {
  console.log(`ℹ️  Using non-standard test database name with explicit opt-in: ${dbName}`);
}

// CRITICAL: Verify test DB and runtime DB are different instances
// (Only in non-test mode, since test mode intentionally sets DATABASE_URL = DATABASE_URL_TEST)
if (process.env.NODE_ENV !== 'test' && process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  if (process.env.DATABASE_URL === process.env.DATABASE_URL_TEST) {
    console.error('FATAL: DATABASE_URL and DATABASE_URL_TEST must point to different databases');
    console.error('Using the same database for runtime and tests causes data loss and test pollution');
    process.exit(1);
  }

  try {
    const testUrl = new URL(process.env.DATABASE_URL_TEST);
    const runtimeUrl = new URL(process.env.DATABASE_URL);

    // Prevent same host + port (different DB name only is not safe enough)
    if (testUrl.host === runtimeUrl.host && (testUrl.port || 5432) === (runtimeUrl.port || 5432)) {
      console.error('FATAL: DATABASE_URL_TEST and DATABASE_URL must point to different database instances');
      console.error('(Same host+port with different database names is not sufficient protection)');
      console.error('Test host:port:', `${testUrl.host}:${testUrl.port || 5432}`);
      console.error('Runtime host:port:', `${runtimeUrl.host}:${runtimeUrl.port || 5432}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('FATAL: Could not parse database URLs');
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// CRITICAL: Jest tests MUST run with --runInBand (single process)
// templateFactory.ensureActiveTemplate deactivates other active templates for same sport/type
// This is NOT thread-safe and will race if multiple Jest workers run in parallel
if (process.env.JEST_WORKER_ID && process.env.JEST_WORKER_ID !== '1') {
  console.error('FATAL: Tests detected running in parallel (JEST_WORKER_ID=' + process.env.JEST_WORKER_ID + ')');
  console.error('templateFactory requires single-threaded execution (--runInBand)');
  console.error('Jest configuration (jest.config.js) must have: maxWorkers: 1');
  console.error('Run: npm test (which enforces --runInBand)');
  process.exit(1);
}

// DATABASE_URL is optional (not required for tests)
// If DATABASE_URL is defined in non-test mode, verify it points to a different instance than DATABASE_URL_TEST
if (process.env.NODE_ENV !== 'test' && process.env.DATABASE_URL) {
  // Prevent accidental use of runtime database in tests
  if (process.env.DATABASE_URL_TEST === process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL_TEST must not equal DATABASE_URL');
    console.error('Integration tests MUST use a different database instance');
    process.exit(1);
  }

  // Verify test DB and runtime DB point to different instances
  try {
    const testUrl = new URL(process.env.DATABASE_URL_TEST);
    const runtimeUrl = new URL(process.env.DATABASE_URL);

    if (testUrl.host === runtimeUrl.host && testUrl.port === runtimeUrl.port) {
      console.error('FATAL: DATABASE_URL_TEST must point to a different database instance than DATABASE_URL');
      console.error('Test host:port:', `${testUrl.host}:${testUrl.port || 5432}`);
      console.error('Runtime host:port:', `${runtimeUrl.host}:${runtimeUrl.port || 5432}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('FATAL: Invalid database URL format');
    console.error('DATABASE_URL_TEST and DATABASE_URL must be valid PostgreSQL connection strings');
    console.error('Error:', err.message);
    process.exit(1);
  }
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

  // Stop Apple JTI cleanup interval if server was loaded
  const serverModuleId = require.resolve('../server');
  const serverModule = require.cache[serverModuleId];
  if (serverModule) {
    const { stopCleanup, pool } = serverModule.exports;
    if (stopCleanup && typeof stopCleanup === 'function') {
      stopCleanup();
    }
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }
});

// Global test timeout
jest.setTimeout(30000);
