# System Status & Known Issues
67 Enterprises – Playoff Challenge Platform

Version: V1.2
Updated: March 11, 2026
Status: IDENTIFIED BLOCKERS FOR LAUNCH

---

# System Status — Current State

## Completed Fixes

### 0. Ingestion Worker Polling Interval Configuration — FIXED
**Status:** ✅ RESOLVED

**Issue:** Ingestion worker was ignoring the `INGESTION_WORKER_INTERVAL_MS` environment variable and using hardcoded lifecycle-based polling intervals (5s for LIVE, 30s for LOCKED, etc.).

**Solution Implemented:**
- Added `OVERRIDE_INTERVAL` configuration constant that reads from `INGESTION_WORKER_INTERVAL_MS` env var
- Updated `getHighestContestStatus()` to respect the override interval
- When env var is set, worker uses that interval for all contest statuses
- When env var is not set, worker falls back to lifecycle-based adaptive polling (original behavior)
- Enhanced startup logging to show which configuration mode is active

**Configuration:**
```javascript
const OVERRIDE_INTERVAL = process.env.INGESTION_WORKER_INTERVAL_MS
  ? Number(process.env.INGESTION_WORKER_INTERVAL_MS)
  : null;
```

**Impact:** Production deployments can now control ingestion worker polling frequency via environment variable while maintaining backward compatibility.

**Files Modified:**
- `/backend/workers/ingestionWorker.js`

**Startup Behavior:**
- With `INGESTION_WORKER_INTERVAL_MS=60000`: `[Ingestion Worker] Starting with OVERRIDE_INTERVAL=60000ms (from INGESTION_WORKER_INTERVAL_MS env var)`
- Without env var: `[Ingestion Worker] Starting with lifecycle-based adaptive polling (INGESTION_WORKER_INTERVAL_MS not set)`

---

### 1. Join Contest Ledger Race Condition — FIXED
**Status:** ✅ RESOLVED

**Issue:** Race condition in contest join when multiple participants join simultaneously, causing missing ENTRY_FEE ledger entries.

**Solution Implemented:**
- `joinContest()` now verifies that ledger debit entry exists before returning success
- Race condition branch self-heals by detecting and creating missing ENTRY_FEE entries
- Idempotency key enforcement maintained to prevent duplicate entries

**Impact:** Contest joining is now safe for concurrent operations. Ledger integrity guaranteed.

**Files Modified:**
- `/backend/services/customContestService.js`

---

### 2. Unjoin Contest Bug — FIXED
**Status:** ✅ RESOLVED

**Issue:** Authorization and cooldown logic errors in `leaveContest()` flow.

**Solution Implemented:**
- Corrected authorization checks to verify user is participant
- Fixed cooldown enforcement to prevent immediate leave after join
- Proper refund ledger entries created on valid leave

**Impact:** Contest leave flow now safe. Cooldown policy enforced correctly.

**Files Modified:**
- `/backend/services/customContestService.js`

---

### 3. Add Player to Lineup Bug — FIXED
**Status:** ✅ RESOLVED

**Issue:** Player lineup submissions failing; UI showing stale data; backend contract misalignment.

**Solution Implemented:**
- Lineup submission now properly persists players to database
- UI and backend contract aligned on response shape
- Field initialization guarded to prevent empty player pools

**Impact:** Lineup submissions working end-to-end. Players correctly saved.

**Files Modified:**
- `/backend/services/entryRosterService.js`
- `/ios-app/PlayoffChallenge/Views/ContestDetailView.swift`
- `/ios-app/PlayoffChallenge/ViewModels/ContestDetailViewModel.swift`

---

### 4. Discovery and Settlement Test Stability — FIXED
**Status:** ✅ RESOLVED

Recent test failures in the discovery and settlement subsystems have been resolved.

---

### 5. Player Pool Visibility Bug (PGA Contests) — FIXED
**Status:** ✅ RESOLVED (March 13, 2026)

**Issue:** Newly joined PGA golf contests sometimes displayed no available players in the iOS MyLineup view.

**Root Cause:** Timing race condition between contest publish and discovery ingestion:
- `publishContestInstance()` calls `ensureFieldSelectionsForGolf()` immediately upon publish
- This function attempts to create a `field_selections` row with FK to `tournament_configs`
- But `tournament_configs` is created asynchronously by discovery ingestion
- If discovery hadn't run yet, the FK-constrained INSERT silently failed
- When users later joined the contest, `getMyEntry()` had no `field_selections` row and returned empty `available_players`

**Solution Implemented:**
- Modified `entryRosterService.getMyEntry()` to lazily create `field_selections` when needed
- Lazy creation only occurs if `tournament_configs` exists (never fabricates foreign keys)
- Idempotent via `ON CONFLICT DO NOTHING` — safe under concurrent requests
- Non-blocking error handling — fallback to players table if creation fails
- New test suite: `tests/roster/playerPoolFallback.test.js` (4 test cases, all passing)

**Implementation Details:**
- File: `/backend/services/entryRosterService.js` (lines 348-387)
- Logic: IF field_selections missing OR primary empty, AND tournament_configs exists → auto-create
- Populated primary array with all active GOLF players from database
- Idempotency strategy: Check if `tournament_configs` row exists before inserting

**Test Coverage:**
1. Tournament_configs missing → fallback players returned, no insert
2. Tournament_configs exists → lazy insert occurs with populated primary
3. Repeated calls → idempotent via ON CONFLICT DO NOTHING
4. Existing field_selections → no mutation occurs

**Impact:** Player pools are now guaranteed on first roster access, regardless of discovery ingestion timing.

**Files Modified:**
- `/backend/services/entryRosterService.js` (lazy creation logic added)
- `/backend/tests/roster/playerPoolFallback.test.js` (new test suite)

**Fix A — Settlement Audit FK**

SYSTEM_USER_ID ('00000000-0000-0000-0000-000000000000') is now created during test bootstrap.

This ensures the admin_contest_audit FK constraint referencing users(id) is satisfied during settlement audit writes.

Settlement isolation tests now pass.

**Fix B — Discovery Template Binding**

Discovery templates must bind using:

provider_tournament_id = event.provider_event_id

Test fixtures were corrected to align template identifiers with the discovery event identifier.

Discovery contest creation tests now pass.

**Fix C — Contest Uniqueness Constraint**

The platform enforces the invariant:

UNIQUE(provider_event_id, template_id, entry_fee_cents)

Tests were updated to respect this invariant by using a different entry_fee_cents value for the second contest instance.

**Result:**

Discovery tests: 144 / 144 passing
Settlement isolation tests: 4 / 4 passing

**Files Modified:**
- `/backend/tests/discovery/` (all test suites)
- `/backend/tests/services/` (settlement and discovery service tests)

---

## Test Suite Signal

**Current Test Results (as of March 11, 2026):**

| Metric | Value |
|--------|-------|
| Total Test Suites | 169 |
| Passing Suites | 133 |
| Failing Suites | 34 |
| Total Tests | 2797 |
| Passing Tests | 2646 |
| Failing Tests | 151 |
| Success Rate | 94.6% |

**Failure Clustering:**
- Authentication middleware regressions
- Discovery system failures
- Financial reconciliation queries
- Schema drift issues
- Join ledger race-condition test expectations

---

# Known Platform Issues

## P0 — LAUNCH BLOCKING

These issues prevent production launch and must be resolved first.

### P0-1: Authentication Middleware Regression
**Severity:** CRITICAL
**Scope:** Multi-endpoint

**Description:**
Many endpoints returning 401 Unauthorized in test suite despite valid credentials being provided.

**Affected Systems:**
- Wallet endpoints
- Picks/lineup endpoints
- User profile endpoints
- Contest detail endpoints

**Impact:**
- API clients unable to authenticate
- Production traffic will fail
- Financial operations blocked

**Status:** OPEN — Requires investigation

**Next Steps:**
1. Verify auth middleware configuration
2. Check token validation logic
3. Review environment-specific auth setup
4. Test with valid bearer tokens

---

### P0-2: Discovery System Failure
**Severity:** CRITICAL
**Scope:** Contest creation pipeline

**Description:**
Discovery worker fails with `template_id NOT NULL constraint violation`. Contest creation is completely blocked.

**Root Cause:**
Unknown — likely template_id missing in discovery run or contest instance creation logic.

**Impact:**
- New contests cannot be created
- Discovery cannot run
- Test contest creation fails

**Status:** OPEN — Requires deep investigation

**Next Steps:**
1. Review discovery worker logic for template_id assignment
2. Check contest instance creation defaults
3. Verify test data setup
4. Trace discovery run end-to-end

---

### P0-3: Financial Reconciliation Query Regression
**Severity:** CRITICAL
**Scope:** Ledger system

**Description:**
Reconciliation queries returning zero rows when expecting financial data. Services crash on `rows[0]` access.

**Impact:**
- Wallet balance queries fail
- Ledger reconciliation blocked
- Financial reporting broken
- Admin dashboards broken

**Status:** OPEN — Requires query repair

**Next Steps:**
1. Review reconciliation query logic
2. Check ledger table structure against queries
3. Verify join conditions and filters
4. Test queries in isolation

---

### P0-4: Wallet Endpoint Authentication Failures
**Severity:** CRITICAL
**Scope:** Financial operations

**Description:**
Wallet-related endpoints consistently returning 401, even with valid authentication. Likely related to P0-1 auth regression.

**Impact:**
- Users cannot check balance
- Deposits cannot be initiated
- Withdrawals cannot be initiated

**Status:** OPEN — Dependent on P0-1 fix

---

## P1 — Core Platform Drift

These issues represent architectural misalignment but do not immediately block launch if workarounds are in place.

### P1-1: Schema Drift — contest_instances.current_entries Removed
**Severity:** HIGH
**Scope:** Contest model

**Description:**
`contest_instances.current_entries` column removed from schema. Tests and code still reference it.

**Workaround:**
Derive participant count from `contest_participants` table using GROUP BY and COUNT().

**Files Affected:**
- Contest read queries
- Contest test fixtures
- Contest detail responses

**Impact:**
- Contest state tracking affected
- Entry count displays may be incorrect
- Tests relying on column fail

**Status:** OPEN — Requires query migration

---

### P1-2: Join Ledger Race-Condition Test Expectation Mismatch
**Severity:** HIGH
**Scope:** Test suite

**Description:**
Tests written to expect NO ledger debit on join. New behavior ensures debit exists. Test expectations need update.

**Changes Required:**
- Update test assertions to expect ENTRY_FEE debit
- Verify debit amounts match entry fees
- Update mock data to include ledger entries

**Status:** OPEN — Requires test updates

---

### P1-3: Contest Publish Wallet Balance Enforcement
**Severity:** HIGH
**Scope:** Contest lifecycle

**Description:**
Tests assume publish can succeed without wallet balance. New behavior may enforce organizer must have sufficient funds.

**Clarification Needed:**
- Is this a requirement or a test issue?
- Should organizer require funds to publish?
- If required, must be documented in governance

**Status:** OPEN — Requires clarification

---

### P1-4: Admin Route Export Regression
**Severity:** HIGH
**Scope:** Web admin / API server

**Description:**
`app.address is not a function` error when admin routes attempt to export server address/port.

**Root Cause:**
Likely `app` is not the Express server instance, or export pattern changed.

**Impact:**
- Admin routes cannot initialize
- Web admin cannot connect
- Admin tooling unavailable

**Status:** OPEN — Requires code review

---

## P2 — Behavioral / Policy Changes

These issues represent intentional policy changes that require documentation and test updates.

### P2-1: Contest Leave Cooldown
**Severity:** MEDIUM
**Scope:** Contest lifecycle

**Description:**
Users cannot leave a contest immediately after joining. Cooldown period enforced.

**Policy:**
- Join time recorded
- Leave blocked for N seconds/minutes after join
- After cooldown expires, leave is allowed

**Documentation Required:**
- Update contest lifecycle governance doc
- Document cooldown duration
- Add error codes for cooldown violations

**Status:** OPEN — Requires policy documentation

---

### P2-2: SQL Ordering Contract Changes
**Severity:** MEDIUM
**Scope:** API responses

**Description:**
Query result ordering has changed. Tests expecting specific row order may fail.

**Root Cause:**
Likely missing `ORDER BY` clauses in recent refactoring.

**Impact:**
- Test assertions on row order fail
- API response ordering unpredictable

**Status:** OPEN — Requires investigation

**Next Steps:**
1. Identify which queries have ordering issues
2. Add deterministic `ORDER BY` clauses
3. Update tests to match new ordering or use set-based assertions

---

### P2-3: Ingestion Worker Dispatch Behavior
**Severity:** MEDIUM
**Scope:** Discovery pipeline

**Description:**
Worker dispatch behavior has changed. Unclear if this is intentional optimization or regression.

**Status:** OPEN — Requires review

---

# Launch Readiness Assessment

## Status: NOT READY

### Blocking Issues (Must Resolve):
1. ❌ Authentication middleware regression (P0-1)
2. ❌ Discovery system failure (P0-2)
3. ❌ Financial reconciliation regression (P0-3)
4. ❌ Wallet endpoint auth failures (P0-4)

### High-Priority Drift (Should Resolve):
1. ⚠️ Schema drift on contest_instances (P1-1)
2. ⚠️ Join ledger test expectations (P1-2)
3. ⚠️ Admin route export regression (P1-4)

### Accepted for V1 (with Documentation):
1. ✅ Contest leave cooldown (P2-1, requires policy doc)
2. ✅ SQL ordering changes (P2-2, requires investigation)
3. ✅ Worker dispatch behavior (P2-3, requires review)

---

# Next Steps

1. **Immediate:** Address all P0 issues before proceeding
2. **After P0:** Resolve P1 schema and test misalignments
3. **Before Launch:** Update governance docs to reflect new policies
4. **Final:** Re-run full test suite to confirm all systems healthy

---

# Notes

System is stable at core but has regressions in authentication, discovery, and reconciliation paths.

Recent fixes to contest joining and lineup submission are solid and well-tested.

Focus stabilization effort on P0 issues before considering production launch.


---
New issues
* ios app - Home and Contest tab not showing any contets.  I understand this is because there is only 5 contets, but they must have moved to live which is great.  However, because none of the lists show the contests, i cant see the live ones.  

* ensure scoring works for all contets and leaderboard displays the scores.