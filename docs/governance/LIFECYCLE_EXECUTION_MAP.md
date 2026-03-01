# Lifecycle Execution Map

**Purpose:** Single authoritative reference for all contest lifecycle transitions.
Prevents fragmented execution entry points and orchestration drift.

---

## Document Hierarchy

| Document | Authority | Purpose |
|----------|-----------|---------|
| **docs/governance/CLAUDE_RULES.md** | GOVERNANCE LOCK | Defines frozen vs evolving layers, system maturity axes, change control |
| **docs/governance/LIFECYCLE_EXECUTION_MAP.md** | OPERATIONAL REFERENCE | Names exact primitives, entry points, and execution model per transition |

**Conflict Resolution:** If this map conflicts with docs/governance/CLAUDE_RULES.md, CLAUDE_RULES.md prevails.

**Status Language:** All statuses align with docs/governance/CLAUDE_RULES.md § 17 System Maturity Matrix:
- **FROZEN:** Primitive contract locked by tests and governance. No further changes allowed.
- **EVOLVING:** Primitive exists but trigger/execution model still being designed.
- **PENDING:** Primitive does not yet exist. Requires implementation.

---

## State Machine

```
┌─────────────┐
│ SCHEDULED   │
└──────┬──────┘
       │ (SCHEDULED → LOCKED)
       ▼
┌─────────────┐
│  LOCKED     │
└──────┬──────┘
       │ (LOCKED → LIVE)
       ▼
┌─────────────┐
│   LIVE      │
└──────┬──────┘
       │ (LIVE → COMPLETE)
       ▼
┌─────────────┐
│ COMPLETE    │  [TERMINAL]
└─────────────┘

┌─────────────┐
│ CANCELLED   │  [TERMINAL, can be entered from any state except COMPLETE]
└─────────────┘
```

---

## Transitions Registry

### Transition 1: SCHEDULED → LOCKED 🔄 EVOLVING (Operational)

| Property | Value |
|----------|-------|
| **Primitive Owner** | `contestLifecycleService.transitionScheduledToLocked()` |
| **Primitive File** | `backend/services/contestLifecycleService.js` (lines ~20-54) |
| **Primitive Type** | Pure, deterministic, callable function |
| **Trigger Owner** | Background poller (`startLifecycleReconciler()`) |
| **Execution Layer** | OPERATIONAL (30s interval, ENABLE_LIFECYCLE_RECONCILER=true) |
| **Frozen Status** | ✅ Primitive FROZEN (contract locked) |
| **Entry Point** | `reconcileLifecycle()` in `lifecycleReconciliationService.js` (single entry point) |
| **Atomicity** | ✅ Single CTE (UPDATE + INSERT) |
| **Idempotency** | ✅ Verified (already-LOCKED contests skipped) |
| **State Persistence** | ✅ `contest_state_transitions` record (LOCK_TIME_REACHED) |
| **Test Coverage** | ✅ 8 lifecycle + 4 reconciler tests (boundary, atomicity, idempotency, ordering) |
| **Requirements** | `lock_time IS NOT NULL`, `now >= lock_time` |
| **Implementation** | `backend/services/contestLifecycleService.js`, `lifecycleReconciliationService.js`, `lifecycleReconcilerWorker.js` |
| **Governance** | docs/governance/CLAUDE_RULES.md § 16 + new § Lifecycle Orchestration Rules |
| **Operational Status** | Primitive frozen, trigger operational, HA/monitoring pending (Phase 2D) |

#### Timestamp Strategy (Day 1)

**Current implementation:**
```
lock_time = tournament_start_time
```

**Result:**
- SCHEDULED → LOCKED (via lock_time)
- LOCKED → LIVE (via tournament_start_time)
may execute on the same reconciliation tick (since lock_time == tournament_start_time on Day 1).

This is intentional and safe due to:
- State-gated transitions
- Atomic updates
- Idempotent primitives
- Time-based enforcement

**No user-facing LOCKED state required in Phase 2A.**

---

### Transition 2: LOCKED → LIVE (Tournament Start Time) ✅ LOCKED

| Property | Value |
|----------|-------|
| **Primitive Owner** | `contestLifecycleService.transitionLockedToLive()` |
| **Primitive Type** | Pure, deterministic, callable function |
| **Trigger Owner** | DEFERRED (Phase 2+ orchestration layer) |
| **Execution Layer** | EVOLVING (no automatic execution yet) |
| **Frozen Status** | ✅ FROZEN (primitive contract locked) |
| **Entry Point** | `transitionLockedToLive(pool, now)` |
| **Atomicity** | ✅ Single CTE (UPDATE + INSERT) |
| **Idempotency** | ✅ Verified (already-LIVE contests skipped) |
| **State Persistence** | ✅ `contest_state_transitions` record (TOURNAMENT_START_TIME_REACHED) |
| **Test Coverage** | ✅ 8 integration tests (boundary, isolation, atomicity) |
| **Requirements** | `tournament_start_time IS NOT NULL`, `now >= tournament_start_time` |
| **Implementation** | `backend/services/contestLifecycleService.js` |
| **Governance** | docs/governance/CLAUDE_RULES.md Section 16 |
| **Notes** | Injected `now` enforces determinism. No raw database clock. Ready to be called from scheduler, admin endpoint, or event-driven trigger. |

---

### Transition 3: LIVE → COMPLETE (Automatic Settlement)

#### Primitive Layer (Frozen)

| Property | Value |
|----------|-------|
| **Primitive Owner** | `contestLifecycleService.transitionLiveToComplete(pool, now)` |
| **Primitive File** | `backend/services/contestLifecycleService.js` (MVP Phase 3) |
| **Primitive Type** | Lifecycle orchestration (calls executeSettlement for eligible contests) |
| **Frozen Status** | ✅ **FROZEN** — Contract locked by 6 integration tests |
| **Atomicity** | ✅ Via settlement transaction (each contest settled atomically with status update + transition record) |
| **Idempotency** | ✅ Verified (settlement_records exist check + NOT EXISTS for transition insert) |
| **State Persistence** | ✅ `contest_state_transitions` record inserted (from_state = LIVE, to_state = COMPLETE, triggered_by = TOURNAMENT_END_TIME_REACHED) |
| **Test Coverage** | ✅ `contestLifecycleCompletion.integration.test.js` (6 tests: boundary, null, idempotency, missing snapshot, transition structure) |
| **Requirements** | status = LIVE, tournament_end_time IS NOT NULL, now >= tournament_end_time, FINAL snapshot must exist |
| **Settlement Binding** | ✅ executeSettlement validates snapshot_id + snapshot_hash inside transaction |
| **Governance** | docs/governance/CLAUDE_RULES.md § 7 (Settlement Engine Rule), § 16 (Frozen Invariants) |
| **Notes** | If snapshot missing, leaves contest LIVE and continues (non-fatal). Errors logged but don't block batch. |

#### executeSettlement Enhancements (Backward Compatible)

| Property | Value |
|----------|-------|
| **Signature Change** | Added optional `now` parameter (defaults to `new Date()`) |
| **Status Guard** | Added WHERE status = 'LIVE' to UPDATE (rejects non-LIVE contests gracefully) |
| **Determinism** | Replaced NOW() with injected `now` for settle_time and transition created_at |
| **Transition Record** | Inserts LIVE → COMPLETE transition inside settlement transaction (NOT EXISTS idempotent) |
| **Backward Compatible** | ✅ Yes — optional `now` preserves existing call sites |

#### Trigger Layer (Frozen)

| Property | Value |
|----------|-------|
| **Trigger Owner** | Background poller (`startLifecycleReconciler`) |
| **Execution Layer** | `reconcileLifecycle(pool, now)` as Phase 3 (after LOCKED → LIVE) |
| **Trigger Type** | Automatic (every 30s, same as other phases) |
| **Frozen Status** | ✅ **FROZEN** — Background poller contract unchanged, Phase 3 integrated into existing orchestration |
| **Entry Point** | Single: `reconcileLifecycle()` in `lifecycleReconciliationService.js` |
| **Notes** | No new endpoints, no manual settlement paths for MVP (admin paths unchanged but deprecated). |

---

### Transition 4: → CANCELLED (Any non-terminal state)

#### Primitive 1: Provider-Initiated Cancellation (Discovery)

| Property | Value |
|----------|-------|
| **Primitive Owner** | `discoveryService.processDiscovery()` (Phase 1: Provider state changes) |
| **Primitive File** | `backend/services/discovery/discoveryService.js` (lines ~104-143) |
| **Primitive Type** | Service function (CTE-based atomic cascade) |
| **Frozen Status** | **FROZEN** — Cascade ordering Phase 1 → 2 → 3 locked by docs/governance/CLAUDE_RULES.md § 12 |
| **Trigger Owner** | Discovery webhook or admin endpoint (discovery trigger varies) |
| **Entry Point** | Discovery ingestion pipeline (external provider webhook) |
| **Atomicity** | ✅ CTE with FOR UPDATE lock (atomic UPDATE + INSERT transitions) |
| **Idempotency** | ✅ Verified (repeated CANCELLED discovery = zero duplicate transitions) |
| **State Persistence** | ✅ `contest_state_transitions` records (triggered_by = 'PROVIDER_TOURNAMENT_CANCELLED') |
| **Test Coverage** | ✅ `discoveryService.cancellation.test.js` (cascade, idempotency, ordering) |
| **Governance** | docs/governance/CLAUDE_RULES.md § 12 (Discovery Service Lifecycle Ordering) |
| **Notes** | Provider cancellation is Phase 1 of discovery lifecycle. Cascades all non-terminal instances under same template. |

#### Primitive 2: Admin-Initiated Cancellation

| Property | Value |
|----------|-------|
| **Primitive Owner** | `adminContestService.cancelContestInstance()` |
| **Primitive File** | `backend/services/adminContestService.js` (lines ~TBD) |
| **Primitive Type** | Service function (direct cancellation, single contest) |
| **Frozen Status** | **FROZEN** — Idempotent transitions locked by admin service tests |
| **Trigger Owner** | Admin endpoint |
| **Entry Point** | `POST /api/admin/contests/:id/cancel` |
| **Atomicity** | ✅ Via transaction (SELECT...FOR UPDATE + UPDATE + INSERT transition) |
| **Idempotency** | ✅ If already CANCELLED, returns noop=true (test-verified) |
| **State Persistence** | ✅ `contest_state_transitions` record (triggered_by = 'ADMIN' or similar) |
| **Test Coverage** | ✅ Admin service tests |
| **Governance** | docs/governance/CLAUDE_RULES.md § 16 (Frozen Invariants) |
| **Notes** | Admin cancellation is manual, single-contest operation. Does not cascade. |

---

## Execution Layer Ownership Matrix

### Critical Rule: Frozen Primitive ≠ Frozen Trigger

**A transition is FROZEN only when both primitive AND trigger are frozen.**

Primitive status and trigger status are independent classifications.

---

### SCHEDULED → LOCKED (Lock Time)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `contestLifecycleService.transitionScheduledToLocked(pool, now)` — Contract locked by 8 integration tests (signature, semantics, determinism) |
| **Trigger** | 🔄 **EVOLVING** | Background poller (`startLifecycleReconciler()`) on 30s interval, guarded by `ENABLE_LIFECYCLE_RECONCILER=true` |
| **Orchestration** | `reconcileLifecycle()` | Single entry point in `lifecycleReconciliationService.js` — only caller of frozen primitives |
| **Governance** | docs/governance/CLAUDE_RULES.md § 16 | Primitive frozen. Trigger operational but subject to monitoring / HA hardening |
| **Test Suite** | `contestLifecycleTransitions.integration.test.js` (8) + `lifecycleReconcilerWorker.integration.test.js` (4) | Covers boundary, atomicity, idempotency, ordering |
| **Transition Status** | 🔄 **EVOLVING (Operational)** | Primitive frozen, trigger implemented but not yet GA-hardened |

---

### LOCKED → LIVE (Tournament Start Time)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `contestLifecycleService.transitionLockedToLive(pool, now)` — Contract locked by 8 integration tests (signature, semantics, determinism) |
| **Trigger** | 🔄 **EVOLVING** | Background poller (`startLifecycleReconciler()`) on 30s interval, guarded by `ENABLE_LIFECYCLE_RECONCILER=true` |
| **Orchestration** | `reconcileLifecycle()` | Single entry point in `lifecycleReconciliationService.js` — only caller of frozen primitives |
| **Governance** | docs/governance/CLAUDE_RULES.md § 16 | Primitive frozen. Trigger operational but subject to monitoring / HA hardening |
| **Test Suite** | `contestLifecycleTransitions.integration.test.js` (8) + `lifecycleReconcilerWorker.integration.test.js` (4) | Covers boundary, atomicity, idempotency, ordering |
| **Transition Status** | 🔄 **EVOLVING (Operational)** | Primitive frozen, trigger implemented but not yet GA-hardened |

---

### LIVE → COMPLETE (Settlement)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `contestLifecycleService.transitionLiveToComplete()` — Locked by 6 integration tests (idempotency, snapshot binding, missing snapshot handling) |
| **Trigger** | ✅ **FROZEN** | Automatic via background reconciler (every 30s, Phase 3). Entry point: `reconcileLifecycle(pool, now)` |
| **Governance** | docs/governance/CLAUDE_RULES.md § 7, § 16 | Settlement Engine Rule: deterministic, snapshot-bound, idempotent; Lifecycle Orchestration: time-driven, atomic, error-escalating |
| **Test Suite** | `contestLifecycleCompletion.integration.test.js` | 6 tests: boundary (tournament_end_time), null handling, idempotency, missing snapshot, settlement binding, audit trail |
| **Transition Status** | ✅ **FROZEN** | Both primitive and trigger frozen. Automatic, deterministic, settlement-bound. No manual paths in MVP. |

---

### CANCELLED (Provider-Initiated via Discovery)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `discoveryService.processDiscovery()` Phase 1 cascade — CTE atomicity, ordering (Phase 1 → 2 → 3) locked by tests |
| **Trigger** | ✅ **FROZEN** | Discovery webhook pipeline (external provider contract stable) |
| **Governance** | docs/governance/CLAUDE_RULES.md § 12 | Discovery Service Lifecycle Ordering — cascade ordering is immutable |
| **Test Suite** | `discoveryService.cancellation.test.js` | Covers cascade atomicity, idempotency, ordering verification |
| **Transition Status** | ✅ **FROZEN** | Both primitive and trigger frozen. Cascade ordering locked. |

---

### CANCELLED (Admin-Initiated)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `adminContestService.cancelContestInstance()` — Test-locked, idempotent (returns noop=true if already CANCELLED) |
| **Trigger** | ✅ **FROZEN** | Admin endpoint (`POST /api/admin/contests/:id/cancel`) — explicit, well-defined entry point |
| **Governance** | docs/governance/CLAUDE_RULES.md § 16 | Admin transition, idempotency enforced |
| **Test Suite** | `admin.contests.operations.test.js` | Covers idempotency, cancellation from various states |
| **Transition Status** | ✅ **FROZEN** | Both primitive and trigger frozen. Well-defined, idempotent operation. |

---

## Execution Entry Points (Current State)

| Transition | Orchestration Entry Point | Trigger Mechanism | Status |
|-----------|-----------|---------------------|--------|
| SCHEDULED → LOCKED | `reconcileLifecycle(pool, now)` (Phase 1) | Background poller (30s interval, ENABLE_LIFECYCLE_RECONCILER=true) | 🔄 **EVOLVING (Operational)** |
| LOCKED → LIVE | `reconcileLifecycle(pool, now)` (Phase 2) | Background poller (30s interval, ENABLE_LIFECYCLE_RECONCILER=true) | 🔄 **EVOLVING (Operational)** |
| LIVE → COMPLETE | `reconcileLifecycle(pool, now)` (Phase 3) | Background poller (30s interval, ENABLE_LIFECYCLE_RECONCILER=true) | ✅ **FROZEN** |
| → CANCELLED (Provider) | `discoveryService.processDiscovery()` | Discovery webhook pipeline | **FROZEN** |
| → CANCELLED (Admin) | `adminContestService.cancelContestInstance()` | `POST /api/admin/contests/:id/cancel` | **FROZEN** |

---

## Next Phase: Orchestration Layer Design

**Critical decisions before wiring execution:**

1. **SCHEDULED → LOCKED**
   - Who decides when a LOCKED contest should actually lock?
   - Is it time-based (lock_time)? Event-based (ingestion start)? Manual?
   - Should this be automatic or admin-triggered?

2. **LOCKED → LIVE**
   - Should this be polled periodically by a scheduler?
   - Should this be event-driven (tournament start detected)?
   - Should this be admin-triggered (`PATCH /api/admin/contests/:id/force-live`)?
   - **Constraint:** Only call with injected `now`, never raw `NOW()`

3. **LIVE → COMPLETE**
   - Should this remain manual (`POST /api/admin/.../settle`)?
   - Should this be automatic after tournament ends?
   - Should this be polled by background job?

4. **Trigger Isolation**
   - Each transition should have ONE authoritative entry point
   - No dual-path orchestration (prevents race conditions)
   - If multiple trigger mechanisms exist, use CTE + FOR UPDATE to serialize

---

## Governance Rule: No Orphan Triggers

**Strict Rule (Post-Implementation):**

Every lifecycle transition must have:
1. ✅ Frozen primitive (service function)
2. ✅ Documented entry point (where/how it's called)
3. ✅ Single authoritative trigger (no competing orchestrations)
4. ✅ Clear ownership (service/endpoint responsible for calling)

**Violation Example (Anti-Pattern):**
```javascript
// ❌ BAD: Two independent entry points
// Entry 1: Scheduler calls transitionLockedToLive()
scheduler.every('30s', () => transitionLockedToLive(pool, now));

// Entry 2: Admin endpoint also calls it
router.patch('/api/admin/contests/:id/force-live', () =>
  transitionLockedToLive(pool, now)
);
// Result: Race conditions, duplicate transition records, unclear ownership
```

**Correct Pattern:**
```javascript
// ✅ GOOD: Single decision point
if (shouldAutoTransition) {
  // Scheduler OR admin endpoint?
  // One route. One entry point.
}
```

---

## Summary: Primitive & Trigger Status Matrix

| Transition | Primitive Status | Trigger Status | Overall Status | Notes |
|-----------|------------------|-----------------|----------------|-------|
| **SCHEDULED → LOCKED** | ✅ FROZEN | 🔄 EVOLVING | 🔄 **EVOLVING (Operational)** | Primitive locked, trigger implemented, operational hardening TBD |
| **LOCKED → LIVE** | ✅ FROZEN | 🔄 EVOLVING | 🔄 **EVOLVING (Operational)** | Primitive locked, trigger implemented, operational hardening TBD |
| **LIVE → COMPLETE** | ✅ FROZEN | ✅ FROZEN | ✅ **FROZEN** | MVP Phase 3: Automatic settlement every 30s via reconciler |
| **CANCELLED (Provider)** | ✅ FROZEN | ✅ FROZEN | ✅ **FROZEN** | Cascade ordering + webhook contract both locked |
| **CANCELLED (Admin)** | ✅ FROZEN | ✅ FROZEN | ✅ **FROZEN** | Admin operation + endpoint both locked |

**Key:** Overall status is FROZEN only when BOTH primitive and trigger are FROZEN.

**Primitives Frozen (3):**
- `transitionScheduledToLocked(pool, now)` — 8 integration tests, CTE-based atomicity, deterministic
- `transitionLockedToLive(pool, now)` — 8 integration tests, CTE-based atomicity, deterministic
- `transitionLiveToComplete(pool, now)` — 6 integration tests, settlement-bound atomicity, deterministic

**Operational Status (Background Poller - MVP Complete):**
- Single entry point: `reconcileLifecycle(pool, now)` in `lifecycleReconciliationService.js`
- Phases: Phase 1 (SCHEDULED→LOCKED), Phase 2 (LOCKED→LIVE), Phase 3 (LIVE→COMPLETE) all implemented
- Implemented: 30s interval poller via `startLifecycleReconciler()`
- Missing: Monitoring, HA behavior, multi-instance deployment validation (Phase 2C+ work)

---

## Fast Feedback Commands

Use these to verify lifecycle implementation status:

### Tier 1 — Lifecycle Transitions (Frozen Primitives)

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/e2e/contestLifecycleTransitions.integration.test.js --runInBand --forceExit
```

**Expected:** 8/8 tests passing (LOCKED → LIVE frozen)

### Tier 2 — Discovery Service (Cancellation Cascade)

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/discovery/ --runInBand --forceExit
```

**Expected:** All discovery tests passing (cascade ordering frozen)

### Tier 3 — Full Backend Validation (All Primitives)

```bash
cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret TEST_DB_ALLOW_DBNAME=railway \
npm test -- --forceExit
```

**Expected:** 93+ test suites, 1987+ tests passing (no regressions)

---

## Next Action (Phase 2)

**Do NOT code orchestration without deciding:**

1. **SCHEDULED → LOCKED** — Should this be:
   - Automatic (scheduler polling + lockStrategy)?
   - Admin-triggered (`POST /api/admin/force-lock`)?
   - Event-driven (ingestion start)?

2. **LOCKED → LIVE** — How should this be triggered:
   - Scheduled poller (every 30s check tournament_start_time)?
   - Event-driven (tournament start detected externally)?
   - Admin-triggered (`POST /api/admin/force-live`)?

3. **LIVE → COMPLETE** — Should automatic settlement ever happen:
   - Always manual (`POST /api/admin/settle`)?
   - Auto after tournament_end_time?
   - Auto after all ingestion events received?

4. **Concurrent Triggers** — How to serialize:
   - Use `SELECT...FOR UPDATE` to lock row before transition?
   - Single entry point per transition (no dual paths)?

5. **Execution Model** — Who orchestrates:
   - Background job service?
   - Scheduled task runner (cron)?
   - Event-driven pipeline?

**Once these are decided, orchestration can be built cleanly and safely.**

---

## Lifecycle Engine — FROZEN (v1)

**Status:** LOCKED. No further changes without governance review.

**Primitives Frozen:**
- ✅ `transitionScheduledToLocked()` (SCHEDULED → LOCKED)
- ✅ `transitionLockedToLive()` (LOCKED → LIVE)
- ✅ `transitionLiveToComplete()` (LIVE → COMPLETE via settlement)
- ✅ `attemptSystemTransitionWithErrorRecovery()` (LIVE → ERROR escalation)

**Execution Model (Implemented):**
- Time-driven reconciliation worker (30s interval)
- Deterministic `now` injection for testability
- Atomic state mutations with audit trail (`contest_state_transitions`)
- Error recovery escalation (settlement failures → LIVE → ERROR)
- Idempotent re-runs (safe under repeated execution, zero duplicate writes)

**Test Coverage (26/26 Passing):**
- `contestLifecycleTransitions.integration.test.js`: 16 tests (SCHEDULED→LOCKED→LIVE)
- `contestLifecycleCompletion.integration.test.js`: 6 tests (LIVE→COMPLETE with settlement)
- `lifecycleReconcilerWorker.integration.test.js`: 4 tests (reconciliation ordering, idempotency)

**Contract Guarantees:**
- Only LIVE + past tournament_end_time triggers settlement
- Settlement errors automatically escalate to ERROR via error recovery
- Re-runs produce zero additional mutations or audit records
- Snapshot binding required for settlement (immutability enforcement)
- Provider cancellation cascade support (discovery layer responsibility)

**Next Phase:** Tournament Discovery Foundation (MVP event registry + template abstraction)
