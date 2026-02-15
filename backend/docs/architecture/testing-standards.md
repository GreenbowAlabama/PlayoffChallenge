# Test Isolation Standards

This document defines architectural boundaries for testing that prevent resource leaks, side effects, and non-deterministic behavior.

---

## Test Isolation Policy

### What Unit Tests Must NOT Do

Unit tests are scoped, deterministic, and isolated. They must not:

1. **Import `server.js`**
   - Importing the main server module triggers Express bootstrap, database pool creation, and timer initialization.
   - This causes resource leaks and test suite hangs.
   - Instead: Import services, utilities, or domain functions directly.

2. **Boot Express**
   - Creating or listening on an HTTP server in unit tests introduces race conditions and port conflicts.
   - Tests should mock HTTP behavior, not run actual servers.
   - Exception: Integration tests labeled explicitly as such may boot a test server via supertest if needed.

3. **Create Real Database Pools**
   - Real database connections consume system resources and create test interdependencies.
   - Connection pools left open cause Jest to hang.
   - Instead: Use `createMockPool()` for all unit tests. Mock pool responses deterministically.

4. **Depend on Environment State**
   - Tests must not assume process.env values set by previous tests.
   - Tests must not depend on global variables, singletons, or module-level state.
   - Each test should be runnable in isolation, in any order.

5. **Create Timers or Intervals**
   - `setInterval()`, `setTimeout()`, or event listeners in test modules can prevent Jest exit.
   - Services must not create side-effect timers at import time.
   - Any time-based logic must be mockable or injected.

### How Services Must Be Designed for Testing

All services must accept dependencies via explicit parameter injection:

**Good:**
```javascript
async function calculateFantasyPoints(pool, stats) {
  // pool is injected; no side effects at module load
  const rules = await pool.query(...);
  // ... calculation logic ...
}
```

**Bad:**
```javascript
const pool = require('../db/pool'); // Implicit global dependency

async function calculateFantasyPoints(stats) {
  const rules = await pool.query(...); // Hidden coupling
  // ...
}
```

**Bad:**
```javascript
let globalTimer = null;

module.exports = function myService() {
  if (!globalTimer) {
    globalTimer = setInterval(() => { /* ... */ }, 5000); // Leaks in tests
  }
};
```

---

## Jest Exit Requirements

Jest must exit cleanly after every test run.

### Success Criteria

- `npm test` completes without "Jest did not exit" error.
- `npm test -- --detectOpenHandles` reports zero open handles.
- No dangling TCP connections (TCPWRAP handles).
- No pending timers (Timeout, Interval).
- No unresolved promises.

### Failure Consequences

If Jest hangs:
1. Tests appear to pass but the process never terminates.
2. CI/CD pipelines fail with timeout.
3. Developer workflow is blocked.

### How to Diagnose

```bash
npm test -- --detectOpenHandles --runInBand
```

This outputs:
- The type of open handle (e.g., TCPWRAP, Timeout, Socket).
- The file and line where the handle was created.
- Stack traces for debugging.

### Common Culprits and Fixes

| Issue | Cause | Fix |
|---|---|---|
| TCPWRAP handles | Database pool not closed | Call `pool.end()` in `afterAll()` hook |
| Timeout/Interval | Timer not cleared | Call `clearInterval()` or `clearTimeout()` |
| Socket | HTTP server not closed | Call `server.close()` in `afterAll()` |
| Unresolved Promise | Async operation not awaited | Ensure all async work is awaited before test ends |

---

## Integration Tests vs. Unit Tests

### Unit Tests (Preferred)

- Import specific services or functions directly
- Use `createMockPool()` for database interactions
- No server boot, no real connections
- Fast, deterministic, isolated
- Should comprise ~80% of test suite

**Location:** `tests/services/*.test.js`, `tests/routes/*.test.js`

### Integration Tests (Targeted)

- May require real database (via `DATABASE_URL_TEST`)
- May boot Express server via supertest
- Labeled clearly as "integration"
- Slower, but test real behavior
- Should comprise ~20% of test suite

**Location:** `tests/integration/*.test.js`

**Example:**
```javascript
describe('Integration: Picks Lifecycle', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    await pool.end(); // Always clean up
  });

  // ... tests ...
});
```

---

## Mock Pool Pattern

All unit tests use `createMockPool()` to simulate database behavior without creating real connections.

### Usage

```javascript
const { createMockPool, mockQueryResponses } = require('../mocks/mockPool');

describe('Scoring Service Unit Tests', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool(); // Fresh pool per test

    // Setup response mocks
    mockPool.setQueryResponse(
      /SELECT stat_name, points FROM scoring_rules/,
      mockQueryResponses.scoringRules()
    );
  });

  afterEach(() => {
    mockPool.reset(); // Clean up
  });

  it('should calculate points', async () => {
    const points = await calculateFantasyPoints(mockPool, { pass_yd: 300 });
    expect(points).toBeGreaterThan(0);
  });
});
```

### Mock Pool Guarantees

- No real database connection
- No TCP handles
- No resource leaks
- Fully deterministic
- Fast execution

---

## Dependency Injection Checklist

When writing a new service, follow this checklist to ensure it is testable:

- [ ] Service does not import `server.js`
- [ ] Service does not create a database pool at module load time
- [ ] Service accepts `pool` as a parameter (or other dependencies)
- [ ] Service exports a pure function or class
- [ ] Service can be imported in tests without side effects
- [ ] Service tests use `createMockPool()` and pass it explicitly
- [ ] No timers or intervals are created at module load
- [ ] No global state is modified
- [ ] All async work is properly awaited
- [ ] Tests clean up resources in `afterEach()` or `afterAll()`

---

## Architectural Rule

**Unit tests must never require the full Express server unless explicitly marked as integration tests.**

This rule ensures:
- Fast test execution (no server startup overhead)
- Deterministic behavior (no environment interdependencies)
- Clean Jest exit (no dangling resources)
- Clear test intent (unit vs. integration is explicit)

---

## References

- [Scoring Service Contract](./contest-lifecycle.md#scoring-service-contract)
- [Contest Infrastructure v1 Gaps - Scoring Service Isolation](./contest-infrastructure-v1-gaps.md#scoring-service-isolation--determinism-architecture-enforcement)
