# Lifecycle Execution Map

**Purpose:** Single authoritative reference for all contest lifecycle transitions.
Prevents fragmented execution entry points and orchestration drift.

---

## Document Hierarchy

| Document | Authority | Purpose |
|----------|-----------|---------|
| **CLAUDE_RULES.md** | GOVERNANCE LOCK | Defines frozen vs evolving layers, system maturity axes, change control |
| **LIFECYCLE_EXECUTION_MAP.md** | OPERATIONAL REFERENCE | Names exact primitives, entry points, and execution model per transition |

**Conflict Resolution:** If this map conflicts with CLAUDE_RULES.md, CLAUDE_RULES.md prevails.

**Status Language:** All statuses align with CLAUDE_RULES.md § 17 System Maturity Matrix:
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

### Transition 1: SCHEDULED → LOCKED

| Property | Value |
|----------|-------|
| **Primitive Owner** | `adminContestService.forceLockContestInstance()` |
| **Primitive File** | `backend/services/adminContestService.js` (lines ~93-140) |
| **Primitive Type** | Service function (manual trigger via admin) |
| **Trigger Owner** | Admin endpoint (manually-triggered, not automatic) |
| **Execution Layer** | EVOLVING |
| **Current Entry Point** | `POST /api/admin/contests/:id/force-lock` |
| **Frozen Status** | **EVOLVING** — Primitive exists (forceLockContestInstance), but automatic trigger does not. Lock strategy registry exists in `backend/services/lockStrategy.js` but contains mostly TODO implementations. |
| **Atomicity** | ✅ Via SELECT...FOR UPDATE + transaction |
| **Idempotency** | ✅ If already LOCKED, returns `noop=true` (test-verified in admin service tests) |
| **State Persistence** | ✅ `contest_state_transitions` record inserted (verified via tests) |
| **Automatic Trigger** | ❌ DOES NOT EXIST. Requires Phase 2 orchestration layer to implement scheduler/poller. |
| **Notes** | Lock time computed by sport-specific strategy (e.g., first_game_kickoff, fixed_time, manual). Strategy selection via `lock_strategy_key` from template. Current implementations are TODOs; this layer is not yet functional. Automatic locking (e.g., via cron job) is not yet implemented. |

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
| **Governance** | CLAUDE_RULES.md Section 16 |
| **Notes** | Injected `now` enforces determinism. No raw database clock. Ready to be called from scheduler, admin endpoint, or event-driven trigger. |

---

### Transition 3: LIVE → COMPLETE

#### Primitive Layer (Frozen)

| Property | Value |
|----------|-------|
| **Primitive Owner** | `customContestService.settleContest()` |
| **Primitive File** | `backend/services/customContestService.js` (lines ~1120-1260) |
| **Primitive Type** | Service function (complex, multi-step, deterministic) |
| **Frozen Status** | **FROZEN** — Settlement math locked by `pgaSettlementInvariants.test.js` invariant suite |
| **Atomicity** | ✅ Via settlement service transaction (BEGIN...COMMIT/ROLLBACK) |
| **Idempotency** | ✅ Verified (settlement_records appended, never mutated; re-runs produce identical records) |
| **State Persistence** | ✅ `contest_state_transitions` record inserted (status = LIVE → COMPLETE) |
| **Test Coverage** | ✅ `pgaSettlementInvariants.test.js` (determinism, replay, hash stability, idempotency) |
| **Immutability** | ✅ Binding via `event_data_snapshots.snapshot_id` + `snapshot_hash` (locked by schema) |
| **Governance** | CLAUDE_RULES.md § 7 (Settlement Engine Rule), § 16 (Frozen Invariants) |
| **Notes** | Settlement math is deterministic and replay-safe. No changes to math allowed without governance review. |

#### Trigger Layer (Evolving)

| Property | Value |
|----------|-------|
| **Trigger Owner** | Admin endpoint (currently manual, future: scheduler/event-driven TBD) |
| **Current Entry Point** | `POST /api/admin/contests/:id/settle` |
| **Trigger Type** | Manual (admin-initiated), not automatic |
| **Execution Layer** | EVOLVING |
| **Frozen Status** | **EVOLVING** — Trigger mechanism exists (manual admin), but automatic execution model TBD. |
| **Notes** | Settlement can currently only be triggered manually by admin. Future phase may add automatic settlement based on tournament_end_time or event completion, but that is NOT yet implemented. |

---

### Transition 4: → CANCELLED (Any non-terminal state)

#### Primitive 1: Provider-Initiated Cancellation (Discovery)

| Property | Value |
|----------|-------|
| **Primitive Owner** | `discoveryService.processDiscovery()` (Phase 1: Provider state changes) |
| **Primitive File** | `backend/services/discovery/discoveryService.js` (lines ~104-143) |
| **Primitive Type** | Service function (CTE-based atomic cascade) |
| **Frozen Status** | **FROZEN** — Cascade ordering Phase 1 → 2 → 3 locked by CLAUDE_RULES.md § 12 |
| **Trigger Owner** | Discovery webhook or admin endpoint (discovery trigger varies) |
| **Entry Point** | Discovery ingestion pipeline (external provider webhook) |
| **Atomicity** | ✅ CTE with FOR UPDATE lock (atomic UPDATE + INSERT transitions) |
| **Idempotency** | ✅ Verified (repeated CANCELLED discovery = zero duplicate transitions) |
| **State Persistence** | ✅ `contest_state_transitions` records (triggered_by = 'PROVIDER_TOURNAMENT_CANCELLED') |
| **Test Coverage** | ✅ `discoveryService.cancellation.test.js` (cascade, idempotency, ordering) |
| **Governance** | CLAUDE_RULES.md § 12 (Discovery Service Lifecycle Ordering) |
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
| **Governance** | CLAUDE_RULES.md § 16 (Frozen Invariants) |
| **Notes** | Admin cancellation is manual, single-contest operation. Does not cascade. |

---

## Execution Layer Ownership Matrix

### Critical Rule: Frozen Primitive ≠ Frozen Trigger

**A transition is FROZEN only when both primitive AND trigger are frozen.**

Primitive status and trigger status are independent classifications.

---

### LOCKED → LIVE (Tournament Start Time)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `contestLifecycleService.transitionLockedToLive(pool, now)` — Contract locked by 8 integration tests (signature, semantics, determinism) |
| **Trigger** | **PENDING** | No automatic caller exists. Function is ready but not wired. Requires Phase 2 orchestration design. |
| **Governance** | CLAUDE_RULES.md § 16 | Explicitly documented as frozen primitive |
| **Test Suite** | `contestLifecycleTransitions.integration.test.js` (8 tests) | Covers boundary conditions, atomicity, idempotency, isolation |
| **Transition Status** | **EVOLVING** | Primitive frozen, but trigger pending. Not fully frozen until trigger is decided. |

---

### LIVE → COMPLETE (Settlement)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `customContestService.settleContest()` — Settlement math locked by invariant tests (determinism, replay, idempotency) |
| **Trigger** | **EVOLVING** | Currently manual (`POST /api/admin/contests/:id/settle`). Automatic execution model TBD (tournament_end_time? event-driven?) |
| **Governance** | CLAUDE_RULES.md § 7, § 16 | Settlement Engine Rule: deterministic, snapshot-bound, idempotent |
| **Test Suite** | `pgaSettlementInvariants.test.js` | Covers determinism, replay safety, hash stability |
| **Transition Status** | **EVOLVING** | Primitive frozen (math), but trigger evolving (when to settle). Not fully frozen. |

---

### SCHEDULED → LOCKED (Lock Time)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | **EVOLVING** | `adminContestService.forceLockContestInstance()` — Test-locked (idempotent: noop=true if already LOCKED). Manual trigger exists via endpoint. |
| **Trigger** | **EVOLVING** | Currently manual (`POST /api/admin/contests/:id/force-lock`). Automatic trigger does not exist. Lock strategy implementations are TODOs. |
| **Governance** | CLAUDE_RULES.md § 16 | Admin transition, not yet formally hardened |
| **Test Suite** | `admin.contests.operations.test.js` | Covers idempotency, SCHEDULED-only transition, noop handling |
| **Transition Status** | **EVOLVING** | Both primitive and trigger exist but incomplete. Automatic scheduler not yet implemented. |

---

### CANCELLED (Provider-Initiated via Discovery)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `discoveryService.processDiscovery()` Phase 1 cascade — CTE atomicity, ordering (Phase 1 → 2 → 3) locked by tests |
| **Trigger** | ✅ **FROZEN** | Discovery webhook pipeline (external provider contract stable) |
| **Governance** | CLAUDE_RULES.md § 12 | Discovery Service Lifecycle Ordering — cascade ordering is immutable |
| **Test Suite** | `discoveryService.cancellation.test.js` | Covers cascade atomicity, idempotency, ordering verification |
| **Transition Status** | ✅ **FROZEN** | Both primitive and trigger frozen. Cascade ordering locked. |

---

### CANCELLED (Admin-Initiated)

| Layer | Status | Details |
|-------|--------|---------|
| **Primitive** | ✅ **FROZEN** | `adminContestService.cancelContestInstance()` — Test-locked, idempotent (returns noop=true if already CANCELLED) |
| **Trigger** | ✅ **FROZEN** | Admin endpoint (`POST /api/admin/contests/:id/cancel`) — explicit, well-defined entry point |
| **Governance** | CLAUDE_RULES.md § 16 | Admin transition, idempotency enforced |
| **Test Suite** | `admin.contests.operations.test.js` | Covers idempotency, cancellation from various states |
| **Transition Status** | ✅ **FROZEN** | Both primitive and trigger frozen. Well-defined, idempotent operation. |

---

## Execution Entry Points (Current State)

| Transition | Primitive | Current Entry Point | Status |
|-----------|-----------|---------------------|--------|
| SCHEDULED → LOCKED | `forceLockContestInstance()` | `POST /api/admin/contests/:id/force-lock` | **EVOLVING** (manual only, automatic trigger not yet implemented) |
| LOCKED → LIVE | `transitionLockedToLive(pool, now)` | NONE (function exists, no caller) | **EVOLVING** (primitive ready, orchestration layer missing) |
| LIVE → COMPLETE | `settleContest()` | `POST /api/admin/contests/:id/settle` | **EVOLVING** (manual admin only, automatic trigger not yet implemented) |
| → CANCELLED (Provider) | `discoveryService.processDiscovery()` | Discovery webhook pipeline | **FROZEN** (cascade ordering, but trigger varies) |
| → CANCELLED (Admin) | `cancelContestInstance()` | `POST /api/admin/contests/:id/cancel` | **FROZEN** (idempotent, verified) |

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
| **LOCKED → LIVE** | ✅ FROZEN | PENDING | **EVOLVING** | Primitive test-locked, trigger not wired yet |
| **LIVE → COMPLETE** | ✅ FROZEN | EVOLVING | **EVOLVING** | Math frozen, auto trigger TBD |
| **SCHEDULED → LOCKED** | EVOLVING | EVOLVING | **EVOLVING** | Both exist (manual), automatic not implemented |
| **CANCELLED (Provider)** | ✅ FROZEN | ✅ FROZEN | ✅ **FROZEN** | Cascade ordering + webhook contract both locked |
| **CANCELLED (Admin)** | ✅ FROZEN | ✅ FROZEN | ✅ **FROZEN** | Admin operation + endpoint both locked |

**Key:** Overall status is FROZEN only when BOTH primitive and trigger are FROZEN.

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
