# Lessons Learned – Hardening Program

Governance-grade lessons captured per iteration for architectural continuity and regression prevention.

---

## Iteration 01 – Masters Config-Driven Golf Engine

### Governance Risks Identified and Fixed

#### 1. Silent Coercion is Architectural Risk

**Problem**: Original `validateConfig()` accepted any string for dates, including `"not-a-date"`.

**Impact**: Backend validation was performative, not authoritative. Application could receive structurally invalid dates and fail downstream.

**Fix**: Enforce `instanceof Date` + `isNaN(getTime())` dual validation. No string parsing.

**Lesson for Next Iteration**: Any validation that performs type coercion (string → number, string → date) is suspect. Backend authority means inputs must already be correct type; we verify, not convert.

---

#### 2. Float Flooring is Silent Mutation

**Problem**: Original `applyStrokePlayScoring()` silently floored float strokes to integers via `Math.floor()`.

**Impact**: Invalid upstream data was corrected silently. This violates "fail-loud" and obscures data quality issues. Re-scoring identical data would produce identical results, but the correction hides the problem source.

**Fix**: Reject non-integer strokes explicitly. Let caller fix data quality before re-submission.

**Lesson for Next Iteration**: Any correction operation (flooring, rounding, truncation) is data mutation. If data is invalid, reject it and surface the error. Don't correct invalid data silently.

---

#### 3. NaN Escapes Simple Validation

**Problem**: `if (!config.round_count || typeof config.round_count !== 'number' || config.round_count <= 0)`

When `round_count = NaN`:
- `typeof NaN === 'number'` → true
- `NaN <= 0` → false (NaN comparisons always false)
- Result: NaN passes validation

**Impact**: NaN values can propagate through system undetected until downstream numeric operations fail mysteriously.

**Fix**: Add explicit `Number.isNaN()` check and `Number.isInteger()` check. NaN must be caught by name, not by numeric comparison.

**Lesson for Next Iteration**: `typeof number` is not sufficient validation. Use `Number.isInteger()`, `Number.isNaN()`, `Number.isFinite()` explicitly. Never rely on NaN comparison behavior.

---

#### 4. Integer Validation Requires Multiple Checks

**Problem**: `typeof config.round_count !== 'number'` catches strings but not NaN, Infinity, or floats.

**Impact**: Validation appears exhaustive but has gaps. Iteration 01 required three separate checks:
- `typeof ... !== 'number'` (type check)
- `!Number.isInteger(...)` (range/precision check)
- `!Number.isNaN(...)` (special case)

**Fix**: Sequential validation chain, not single condition.

**Lesson for Next Iteration**: Integer validation is not a one-liner. Require:
1. typeof number
2. Number.isInteger(true)
3. Number.isNaN(false)
4. Number.isFinite(true)

Document this as the canonical integer validation pattern.

---

#### 5. JSON Replay Tests Are Mandatory for Scoring

**Problem**: Deep equality tests (`expect(result1).toEqual(result2)`) confirmed structure but didn't prove determinism for audit purposes.

**Impact**: Scoring could produce different JSON between runs even if objects compare equal. Audit replay would fail because hashes wouldn't match.

**Fix**: Add JSON stringified equality test: `JSON.stringify(result1) === JSON.stringify(result2)`.

**Lesson for Next Iteration**: For any service that must support deterministic replay (scoring, settlement, audit), test both:
1. Deep equality (structural correctness)
2. JSON stringified equality (byte-for-byte reproducibility)

The JSON test catches key ordering issues, floating-point variance, and date formatting inconsistencies that deep equality misses.

---

#### 6. Contract Comments Must Match Implementation Exactly

**Problem**: Iteration 01 CLAUDE.md stated "ranking handled by settlement layer" but implementation never enforced this boundary. Code allowed ranking logic to live in scoring layer without detection.

**Impact**: Documentation can diverge from implementation silently. Tests didn't verify the contract; they only tested what code did.

**Fix**: Add sentinel tests that scan source code for forbidden keywords (handicap, tier, adjustment). Document contract boundaries explicitly and test them.

**Lesson for Next Iteration**: For architectural contracts (separation of concerns, layer boundaries), add:
1. **Sentinel tests**: Search source code for forbidden patterns
2. **Explicit non-goals section**: List what service will NOT do
3. **Boundary comments in code**: Reference CLAUDE.md boundaries in critical functions

This makes contracts testable and drift detectable.

---

### Iteration 01 Decisions That Affect Future Work

#### 1. Stroke Play Only (No Registry)

**Decision**: Hardcoded stroke-play scoring. No scoring rule registry or pluggable rules.

**Impact**: All golf tournaments use identical scoring logic in Iteration 01. When adding another sport (Iteration 02+), create separate engine; don't refactor this one.

**Next Step**: Iteration 02 must NOT attempt to add "generic scoring abstraction" when adding ingestion validation. Keep services separate by sport.

---

#### 2. Ranking Boundary (Engine ↔ Settlement)

**Decision**: Engine outputs stroke totals. Settlement layer computes ranking and payouts.

**Impact**: This prevents tie-breaking logic from contaminating scoring layer. Tie-breaking policy is contest-specific; stroke totals are universal.

**Next Step**: Iteration 02 must respect this boundary. Settlement tests must verify scoring layer is pure (no ranking, no payout logic).

---

#### 3. Integer Strokes Only

**Decision**: Reject float strokes. No decimals in scoring.

**Impact**: Simplifies replay logic and audit validation. No floating-point variance.

**Next Step**: Iteration 02 ingestion must validate provider leaderboard contains integer strokes only. If provider returns floats, ingest rejects before scoring layer sees it.

---

#### 4. Deterministic Key Ordering (by player_id)

**Decision**: All output objects have keys sorted by player_id lexicographically.

**Impact**: Audit layer can hash JSON and detect any data drift. Replay verification becomes byte-for-byte comparison.

**Next Step**: Iteration 02 audit table will enforce this ordering in stored hashes. Settlement must preserve key ordering.

---

#### 5. No Unused Parameters

**Decision**: Removed `results` parameter from `applyStrokePlayScoring()`.

**Impact**: Cleaner contract. Function signature exactly matches what it needs.

**Next Step**: Iteration 02 must not accumulate unused parameters. Every signature parameter is contractually required.

---

### Anti-Patterns to Avoid in Iteration 02+

1. **Don't type-coerce at the boundary**: Require callers to provide correctly-typed data. Backend validates, not converts.

2. **Don't correct invalid data silently**: Reject and surface the error. Let caller fix data quality issues.

3. **Don't use simple numeric comparison for NaN/Infinity checks**: Use explicit `Number.is*` functions.

4. **Don't test deep equality alone for reproducibility**: Test JSON stringified equality for audit safety.

5. **Don't document boundaries without code verification**: Use sentinel tests to enforce architectural contracts.

6. **Don't accumulate unused parameters**: If a parameter is unused, remove it or document why it's reserved.

7. **Don't implement multi-sport abstraction in scoring layer**: Keep sports separate; create new engines, don't refactor.

---

## Continuous Governance Standards

### Every Iteration Must Include

1. **Final Contract Snapshot**: Document exact behavioral guarantees
2. **Explicit Non-Goals Section**: List what you will NOT implement
3. **Lessons Learned**: Capture assumptions purged and risks identified
4. **Sentinel Tests**: Code scan for forbidden patterns
5. **Replay Determinism Test**: JSON stringified output equality, not just deep equality
6. **Schema Snapshot**: Commit exact schema state, even if no changes

### Red Flags for Next Iteration

- Unused parameters in function signatures
- Silent corrections (flooring, rounding, string coercion)
- Type coercion at API boundaries
- Tests that only check deep equality (not JSON equality)
- Documentation that doesn't match code behavior
- Services that accumulate responsibilities across iterations
- Tie-breaking logic creeping into scoring layer
- NaN/Infinity checks using simple numeric comparison

---

## Iteration 01 → Iteration 02 Handoff

Iteration 02 focuses on **Ingestion Safety & Audit**.

### What Iteration 01 Locked In

- ✅ `golfEngine` services are pure, deterministic, fully tested
- ✅ `ContestRulesValidator` handles roster constraints only
- ✅ No ranking, settlement, or persistence in scoring layer
- ✅ Integer strokes, Date objects, explicit validation only

### What Iteration 02 Must Enforce

- [ ] Provider payload hashing for replay verification
- [ ] Audit table captures config version + leaderboard hash + output scores
- [ ] Idempotent scoring: re-run same data, get identical results + audit
- [ ] Strict provider schema version enforcement at ingestion
- [ ] Settlement purity verification (no Stripe, no email, no state mutation in scoring layer)

### Contract Stability

Iteration 01 contracts are **locked**. Iteration 02 cannot:
- Change golfEngine.applyStrokePlayScoring() signature
- Change golfEngine.validateConfig() signature
- Add tier logic to scoring layer
- Add ranking to scoring layer
- Change from integer strokes to float

Only addition allowed: logging/audit context (non-functional).

---

## Governance Closure

**Iteration 01 Lessons Captured**: 2026-02-14

**Status**: Complete. Ready for Iteration 02 design.

---

## Iteration 05 — Automatic Payout Execution Lessons

### 1. PostgreSQL Aggregate Return Types (String Coercion Risk)

**Problem**: PostgreSQL `COUNT()` aggregate returned as string in Node pg driver, not number.

**Discovery**: Unit tests passed (used mocked COUNT values with correct types). Manual E2E in real database discovered type mismatch when comparing terminal counts.

**Impact**: Job finalization logic failed silently because string comparison didn't match numeric logic. Jobs stuck in `processing` state; no error thrown.

**Lesson**: Never rely on implicit type coercion for database aggregates.

**Fix Applied**:
- Repository layer (PayoutTransfersRepository.countTerminalByJobId) now explicitly coerces: `completed: Number(row.completed) || 0, failed: Number(row.failed) || 0, total: Number(row.total) || 0`
- Repositories are the type boundary; aggregates are coerced before returning to service layer
- Unit tests updated to verify returned types are numbers, not strings
- For any aggregate (COUNT, SUM, AVG, MAX, MIN), add explicit type check in repository

**Prevention for Next Iteration**:
- All database operations at repository layer must coerce return types explicitly
- Document return type in service contracts (service receives typed objects, not raw DB rows)
- Unit tests must verify types, not just values: `expect(result.completed).toBeTypeOf('number')`
- For any aggregate (COUNT, SUM, AVG, MAX, MIN), add explicit type check in repository

---

### 2. Scheduler Observability (Never Return Empty Error Objects)

**Problem**: Scheduler returned `{ success: false, error: '' }` when job processing failed.

**Discovery**: Manual test observed job marked failed but `/admin/jobs` diagnostics showed no reason. Operator visibility completely broken.

**Impact**: When scheduler crashed, no information was available to diagnose the failure. Admin endpoint useless for troubleshooting.

**Lesson**: Every side-effect operation must return rich error context, not empty objects.

**Fix Applied**:
- Scheduler now returns: `{ success: false, jobs_processed: N, jobs_completed: M, total_transfers_processed: P, errors: [{ jobId, reason }] }`
- Error object always includes: what failed, why it failed, what state was reached before failure
- adminJobs.updateJobStatus() now receives complete result object (not just true/false)
- `/admin/jobs` endpoint reflects full job history with reasons for any failures

**Prevention for Next Iteration**:
- All scheduled jobs must return structured result: `{ success: boolean, context: {...} }`
- All error objects must include: error code, human message, and recovery hint
- Never return `{ error: '' }` or `{ reason: null }`; always include contextual information
- Test observability: run `/admin/jobs` query after any test failure and verify diagnostics are clear

---

### 3. Terminal State Invariants (Finalization Logic Must Be Explicit)

**Problem**: Job finalization logic depended on comparing transfer processing count (attempt_count) against total payouts. When aggregate type was wrong, comparison failed silently.

**Discovery**: Traced stuck jobs to finalization logic not being called at all. Root cause: type mismatch made condition false, so job never marked complete.

**Impact**: Jobs could complete all transfers but remain in `processing` state indefinitely. System appeared hung.

**Lesson**: Terminal state detection must be explicit and data-driven, not inferred.

**Fix Applied**:
- Job finalization now explicitly queries terminal counts: `SELECT COUNT(*) WHERE status IN ('completed', 'failed_terminal')`
- Job marked complete ONLY when: `terminal_count === total_payouts`
- Finalization logic is clear: "job is complete when all transfers are in terminal state"
- No comparison logic mixing attempt counts with total counts

**Prevention for Next Iteration**:
- For any job/batch system, define terminal states explicitly in code comments
- Terminal detection must query actual terminal counts, not infer from attempt counts
- Write unit test: "Job completes when all transfers terminal" (test creates N transfers, all transition to terminal, verify job marked complete)
- Audit final state: after job transitions to complete, query all transfers and verify every one is terminal

---

### 4. E2E Verification Discipline (Manual Database Inspection Catches What Unit Tests Miss)

**Problem**: All unit tests passed. Scheduler wiring was complete. Yet manual E2E revealed three defects that unit tests never caught.

**Discovery**: Manual test executed full flow (settlement → payout job → transfers → Stripe) and inspected database at each stage. Found:
  1. Terminal count returned as string
  2. Scheduler error objects empty
  3. Job finalization never called

**Impact**: Unit tests are necessary but not sufficient for infrastructure hardening. Defects only appeared when system ran end-to-end with real database and scheduler.

**Lesson**: Hardening iterations require real database verification before closure.

**Verification Performed**:
- Created test contest with payment requirement
- Completed contest lifecycle to settlement completion
- Verified settlement_complete event triggered payout_job creation
- Manually triggered scheduler (or waited for 5-minute interval)
- Inspected payout_transfers table for all transfers reaching terminal state
- Verified Stripe transfer IDs persisted for completed transfers
- Verified ledger entries created for all payout attempts
- Tested idempotency: re-ran scheduler, confirmed no duplicate Stripe transfers

**Prevention for Next Iteration**:
- Every iteration must include "Manual E2E Verification" phase before closure
- Verification must inspect real database (not mocks) at multiple stages
- Verification must trigger all dependent services (not just unit tests in isolation)
- Verification must confirm terminal states are actually reached (not assumed)
- Document exact test sequence for next engineer; make it repeatable
- Never close iteration based on unit tests alone; real database verification is mandatory

---

## Continuous Governance Standards (Updated for Iteration 05)

### Every Hardening Iteration Must Include

1. **Database Aggregate Type Validation**: All COUNT/SUM/AVG results explicitly coerced at repository layer
2. **Scheduler Observability Requirements**: All scheduled jobs return rich error context (never empty error objects)
3. **Terminal State Definitions**: Explicit queries for terminal state counts; no inference from attempt counts
4. **Manual E2E Verification Phase**: Real database testing before closure; inspect multiple stages
