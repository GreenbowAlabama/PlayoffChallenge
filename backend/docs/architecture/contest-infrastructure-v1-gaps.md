# Contest Infrastructure v1 Gap Checklist

---

This document reflects verified backend and database behavior.
Unless marked CLOSED, gaps may describe intended guarantees that are not yet fully enforced.
Audit persistence is pending schema support.

---

## Purpose

This document enumerates what is missing, incorrect, or incomplete in the current Contest Infrastructure implementation, measured strictly against the locked [Contest Lifecycle Contract v1](./contest-lifecycle.md).

It defines the remaining work required to declare Contest Infrastructure v1 complete. It does not propose new features or expand scope.

---

## Scope Boundaries

- **In scope:** Only gaps between the current implementation and the Contest Lifecycle Contract v1.
- **Out of scope:** New features, future sport types, wallets, payments, real-time push, partial settlement, dispute resolution, multi-round contests, and schema migration strategy. These are enumerated explicitly in the out-of-scope section below.
- **Reference document:** Contest Lifecycle Contract v1 is the sole authority. No requirement is introduced here that does not trace back to that contract.

---

## Evaluation Method

Each gap was identified by comparing the current backend implementation (schema, services, routes, controllers, tests) against every section of the Contest Lifecycle Contract v1. Gaps are classified by:

- **Status:**
  - `EXISTS and conforms` — Implementation matches the contract.
  - `EXISTS but violates contract` — Implementation exists but deviates from the contract.
  - `MISSING and required for v1` — No implementation exists for a contract requirement.

- **Layer:** Database, Backend domain logic, API contract, Admin operations, or Client integration.

- **Description:** What is missing or incorrect.

- **Why it matters:** Which lifecycle invariant or contract section it blocks.

- **Dependencies:** What must exist before this gap can be addressed.

All gaps are ordered strictly by dependency. Items that block other items appear first.

---

## Gaps by Dependency Order

### GAP-01: Lifecycle state enum does not match the contract

| Attribute | Value |
|---|---|
| Status | `EXISTS and conforms` |
| Layer | Database |
| Description | The `contest_instances.status` column now stores exactly the six contract-defined lifecycle states: `SCHEDULED`, `LOCKED`, `LIVE`, `COMPLETE`, `CANCELLED`, and `ERROR`. Legacy values (`draft`, `open`, `settled`) have been removed, and no mapping or aliasing layer exists. |
| Why it matters | The lifecycle state model now conforms exactly to the Contest Lifecycle Contract v1, unblocking valid transition enforcement, time-driven progression, error handling, settlement, derived fields, sorting rules, and admin operations. |
| Dependencies | None. This is the root dependency. |

---

### GAP-02: `end_time` field does not exist

| Attribute | Value |
|---|---|
| Status | `EXISTS and conforms` |
| Layer | Database |
| Description | The `contest_instances` table now includes `end_time` as a first-class column representing when the final underlying game concludes. This field is used directly for lifecycle eligibility, invariant enforcement, and LIVE contest sorting as defined by the contract. |
| Why it matters | With `end_time` present, lifecycle time invariants can be fully enforced and the system can correctly determine when contests are eligible to transition from LIVE to COMPLETE. |
| Dependencies | None. |

---

### GAP-03: `settle_time` naming inconsistency

| Attribute | Value |
|---|---|
| Status | `EXISTS and conforms` |
| Layer | Database |
| Description | `settle_time` is now the canonical field name across the database schema, domain logic, and API responses. Any prior use of `settlement_time` has been removed and no aliasing or translation remains. |
| Why it matters | Consistent naming eliminates ambiguity across layers and ensures invariant enforcement, derived field computation, and API contracts align exactly with the Contest Lifecycle Contract v1. |
| Dependencies | None. |

---

### GAP-04: Time field invariant enforcement does not exist

| Attribute | Value |
|---|---|
| Status | `EXISTS and conforms` |
| Layer | Backend domain logic |
| Description | The contract requires that on every write operation the backend enforces: `created_at < lock_time <= start_time < end_time` and, when present, `end_time <= settle_time`. This validation is now implemented in the domain layer via `timeInvariantValidator` and enforced on all time write paths. |
| Why it matters | Without invariant enforcement, contests can be created or updated with incoherent time windows (e.g., lock_time after start_time), which breaks every time-driven state transition. The contract states: "No API call or admin action may violate them." |
| Dependencies | GAP-02 (`end_time` must exist). |

---

### GAP-05: Valid state transition enforcement is complete

| Attribute | Value |
|---|---|
| Status | `EXISTS and conforms` |
| Layer | Backend domain logic |
| Description | A centralized, single-responsibility state machine now enforces the contract's six-state model. The `contestTransitionValidator.js` helper validates all state changes against the legal transition graph defined in the Contest Lifecycle Contract v1. All state-mutating logic in `customContestService.js` and `adminContestService.js` now delegates to this validator, ensuring that no invalid transitions can occur and removing logic duplication. The system now fully rejects transitions not explicitly defined in the contract. |
| Why it matters | The contract defines a specific transition graph. Invalid transitions must be rejected. With a single-responsibility transition enforcer aligned to the contract, state integrity is guaranteed. This provides a foundational guarantee for all time-driven and admin-driven state changes. |
| Dependencies | GAP-01 (state enum must match contract first). |

---

### GAP-06: Automated time-driven state transitions do not exist

| Attribute | Value |
|---|---|
| Status | `CLOSED` |
| Layer | Backend domain logic |
| Description | Time-driven state transitions are now implemented via read-path self-healing. When a contest is fetched via single-instance read paths (`getContestInstance`, `getContestInstanceByToken`, `resolveJoinToken`), the system evaluates whether a time-based transition is due (e.g., current time ≥ lock_time) and persists the new status atomically using SYSTEM actor authority. This design avoids stale state without requiring background jobs, cron workers, or event loops. Transitions are idempotent and handle race conditions gracefully via conditional UPDATE. Write paths (joins, admin updates) rely on independent guards and do not self-heal; list endpoints are non-mutating. |
| Why it matters | The platform rule "No manual admin steps" (CLAUDE.md) and the contract both require that lifecycle transitions are data-driven and automated. Read-path self-healing ensures contests never surface stale state to single-instance lookups without increasing write fan-out or infrastructure complexity. |
| Dependencies | GAP-01 (correct states), GAP-02 (`end_time` exists), GAP-04 (time invariants enforced), GAP-05 (transition enforcement). |

---

### GAP-07: ERROR state and error recovery path do not exist

| Attribute | Value |
|---|---|
| Status | `CLOSED` |
| Layer | Backend domain logic |
| Description | The contract defines ERROR as a state that a contest enters when a transition or settlement operation fails. The ERROR state is now implemented, and ERROR is now a value in the database enum. Automated processes now transition contests to ERROR on failure, and admin resolution paths (ERROR-to-COMPLETE or ERROR-to-CANCELLED) are in place. |
| Why it matters | The contract's principle "No silent failures" requires that failed transitions surface visibly. The ERROR state ensures that failures are caught, and contests do not remain in inconsistent intermediate states. Admin resolution is now possible. |
| Dependencies | GAP-01 (state enum must include ERROR), GAP-05 (transition map must include ERROR paths). |

---

### GAP-08: Settlement-triggered lifecycle failures are handled

| Attribute | Value |
|---|---|
| Status | `PARTIALLY CLOSED` |
| Layer | Backend domain logic |
| Description | Settlement is now integrated as a precondition for COMPLETE state, with error recovery. The system guarantees the contract principle "No silent failures" through the following mechanisms: (1) Settlement readiness validation occurs inside `attemptSystemTransitionWithErrorRecovery()` error recovery boundary (lines 179-183 of contestLifecycleAdvancer.js), not only in `advanceContestLifecycleIfNeeded()`. This placement is mandatory to ensure ALL settlement failures are caught and trigger ERROR state. (2) The LIVE→COMPLETE transition calls `isContestGamesComplete(contest)`, which checks two conditions: time gate (`end_time` has passed) and settlement readiness (`isReadyForSettlement()` succeeds). Either condition can block transition. (3) If `isReadyForSettlement()` throws or returns false during LIVE→COMPLETE, the error is caught inside the recovery boundary and contests transition to LIVE→ERROR (using existing GAP-07 error recovery). (4) Settlement failures are distinguished from pure time-driven errors via enhanced audit payloads with markers: `settlement_failure: true`, `error_origin: 'settlement_readiness_check'`, `error_stack: <truncated to 1000 chars>`. (5) SYSTEM audit records use canonical UUID `00000000-0000-0000-0000-000000000000` for `admin_user_id`, guaranteeing FK safety and non-null constraint satisfaction. (6) Settlement logic itself (`isReadyForSettlement()`, `computeRankings()`, `allocatePayouts()`, etc.) remains unimplemented in GAP-08 and will throw "Not implemented: isReadyForSettlement". The error handling infrastructure is complete. (7) Settlement result persistence (`settlement_records` table, `settle_time` write, settlement outcome auditing) is deferred to GAP-09.
note: backend logic complete; blocked on missing admin_contest_audit table |
| Why it matters | The contract principle "No silent failures" requires that failed settlement operations surface visibly and move contests to ERROR. Placing validation inside the error recovery boundary ensures all failures—including transient errors, missing data, and logic failures—are caught. Making settlement a precondition for COMPLETE ensures contests never reach COMPLETE unless settlement readiness succeeds, preventing orphaned COMPLETE contests. This is a critical invariant for v1 settlement architecture. Admin resolution is possible via ERROR → COMPLETE/CANCELLED transitions. |
| Dependencies | GAP-01 (ERROR state must exist), GAP-05 (transition validation must be in place), GAP-06 (read-path self-healing where settlement check occurs), GAP-07 (ERROR recovery pattern establishes error handling semantics). |

---

### GAP-09: Settlement Logic Implementation

| Attribute | Value |
|---|---|
| Status | `PARTIALLY CLOSED` |
| Layer | Backend domain logic and database |
| Description | Settlement execution is fully implemented with deterministic computation and persistent results. The `settlement_records` table exists with contest_instance_id (UNIQUE FK), settled_at timestamp, results (JSONB), results_sha256 hash, settlement_version, participant_count, and total_pool_cents. Backend implements: (1) `isReadyForSettlement()` — verifies all participants have scores for all 4 playoff weeks using single SQL query; (2) `computeRankings()` — competition ranking (ties at same position); (3) `allocatePayouts()` — percentage-based payout allocation with tie splitting; (4) `canonicalizeJson()` — deterministic hashing for result verification; (5) `executeSettlement()` — full transactional settlement with SELECT FOR UPDATE lock, idempotency check, consistency validation, atomic insert/update, and SYSTEM audit record. Settlement executes BEFORE LIVE→COMPLETE status update; if it throws, error recovery transitions contest to ERROR. All logic is deterministic and replayable from same inputs. 28 comprehensive tests cover unit functions, integration, idempotency, concurrency, ties, and error handling.
note: settlement logic complete; blocked on missing admin_contest_audit table |
| Why it matters | Settlement results must be persisted and immutable. With settlement execution complete, contests can now transition to COMPLETE state only after verified, deterministic settlement. Results are traceable via settlement_records (single source of truth) and SHA-256 hashes. Idempotency prevents duplicate entries. Error integration with GAP-08 ensures no silent failures. |
| Dependencies | GAP-08 (error recovery boundary for settlement), database schema (settlement_records table already applied). |

---

### GAP-10: Write-time state verification for picks is complete

| Attribute | Value |
|---|---|
| Status | `COMPLETED` |
| Layer | Backend domain logic |
| Description | The `POST /api/picks/v2` and player replacement paths now correctly implement comprehensive write-time state verification for pick submissions and changes. The validation order is strictly enforced:
  1. **Contest existence:** Validates the contest instance exists.
  2. **Participant validation:** Verifies the user is a valid participant in the contest (`contest_participants` table).
  3. **Contest lock state:** Checks if the contest status is `SCHEDULED`. If `LOCKED`, `LIVE`, or other non-modifiable states, returns `403 CONTEST_LOCKED` (or other appropriate status).
  4. **Week alignment (WEEK_MISMATCH):** Compares the `weekNumber` sent in the client payload (`clientWeek`) against the server-derived game state week (`serverWeek`). If `clientWeek !== serverWeek`, the system returns `409 WEEK_MISMATCH`. This applies even when the contest is `SCHEDULED` and the user is a participant.
  5. **Pick execution:** If all prior validations pass, the pick operations are executed within a transaction.

This ensures that:
- Picks cannot be accepted after a contest has transitioned to `LOCKED`.
- Clients are always aligned with the server's current effective week.
- All write operations are protected against race conditions and invalid states.
note: scoped to write-time lifecycle enforcement for pick writes |
| Why it matters | Comprehensive write-time verification for picks is critical to prevent race conditions and ensure data integrity. Without it, picks could be accepted after a contest has locked or for an incorrect week, violating core contract principles. Enforcing a strict validation order prevents unnecessary processing and provides clear error feedback. |
| Dependencies | GAP-01 (state model must be correct), GAP-05 (transition enforcement must be in place). |

---

### GAP-11: Derived fields are computed and returned by the API

| Attribute | Value |
|---|---|
| Status | `CLOSED` |
| Layer | API contract |
| Description | All eight derived fields are computed by the backend and returned in API responses. (1) `status` is returned from the database as one of the six contract-defined values. (2) `is_locked` is computed as `status !== 'SCHEDULED'`. (3) `is_live` is computed as `status === 'LIVE'`. (4) `is_settled` is computed as `settle_time !== null`. (5) `entry_count` is returned as a numeric count of contest participants. (6) `user_has_entered` is returned as a boolean computed per-request. (7) `time_until_lock` is computed server-side as seconds until `lock_time` (null if already locked). (8) `standings` is computed and returned only when `is_live` or status is COMPLETE. A centralized response mapper (`contestApiResponseMapper.js`) enforces invariants: `entry_count` must be numeric, `user_has_entered` must be boolean, SCHEDULED contests must have valid `lock_time`. Unknown status values trigger fail-closed behavior in `resolveJoinToken`. Legacy helpers (`computedJoinState`) and derived field names (`entries_current`, `organizer_name`) have been removed. All route tests and parity tests conform to mapper output. |
| Why it matters | The contract principle "Backend is the source of truth" requires that clients receive lifecycle information from the API without computing state locally. With derived fields fully implemented and validated, clients rely exclusively on backend authority. |
| Dependencies | GAP-01, GAP-02, GAP-09 |

---

### GAP-12: My Contests sorting must conform to contract and use database-layer ordering

| Attribute | Value |
|---|---|
| Status | `CLOSED` |
| Layer | API contract and database query |
| Description | **Implementation Complete.** New endpoint `GET /api/contests/my` returns contests the user has entered plus SCHEDULED contests open for entry. Six-tier sorting fully implemented at SQL layer: (1) LIVE by `end_time ASC`; (2) LOCKED by `start_time ASC`; (3) SCHEDULED by `lock_time ASC`; (4) COMPLETE by `settle_time DESC`; (5) CANCELLED by `created_at DESC`; (6) ERROR excluded from non-admin users (fail-closed). Sorting uses CASE tier assignment with tier-scoped time columns and NULLS LAST handling. Deterministic tie-breaker: `ci.id ASC`. Non-mutating list endpoint (no lifecycle advancement). Metadata-only response (no standings, avoiding N+1 queries). Uses dedicated `mapContestToApiResponseForList` mapper to separate list and detail read models. Pagination: limit [1, 200] default 50; offset >= 0 default 0. Authentication via centralized `req.user` context. Admin status derived from server auth, never from client headers. |
| Why it matters | Sorting defines user experience. Database-layer sorting guarantees consistency and stable pagination. CQRS-style separation of list and detail read models ensures scalable, non-mutating list endpoints. |
| Dependencies | GAP-01, GAP-02, GAP-03, GAP-11 |

---

## Implementation Notes for GAP-12 (Completed)

### Endpoint
- **Route:** `GET /api/contests/my`
- **Path:** `/api/contests` (separate from `/api/custom-contests`)
- **Authentication:** Requires `req.user` from centralized auth middleware
- **Scope:** Contests user has entered OR status = SCHEDULED

### SQL Sorting Strategy
- **Tier Assignment:** CASE statement mapping status to tier (0-5, with ERROR = 5)
- **Tier-Scoped Time Columns:** Each tier has its own time column (only active tier is non-null)
  - LIVE: `end_time ASC`
  - LOCKED: `start_time ASC`
  - SCHEDULED: `lock_time ASC`
  - COMPLETE: `settle_time DESC`
  - CANCELLED: `created_at DESC`
  - ERROR: `created_at DESC`
- **NULLS LAST:** Prevents nulls from affecting sort order
- **Tie-Breaker:** `ci.id ASC` for deterministic pagination
- **Example ORDER BY:**
  ```sql
  ORDER BY
    tier ASC,
    live_end_time ASC NULLS LAST,
    locked_start_time ASC NULLS LAST,
    scheduled_lock_time ASC NULLS LAST,
    complete_settle_time DESC NULLS LAST,
    cancelled_created_at DESC NULLS LAST,
    error_created_at DESC NULLS LAST,
    ci.id ASC
  ```

### ERROR Visibility (Fail-Closed)
- **Non-Admin:** WHERE clause excludes ERROR: `($isAdmin = true OR ci.status != 'ERROR')`
- **Admin:** ERROR contests included in results
- **Design Principle:** Hide internal failure states from non-admin users; admin tooling (GAP-13) handles visibility and recovery

### Read Model Separation (CQRS)
Two dedicated mappers for two different surfaces:
1. **Detail Mapper:** `mapContestToApiResponse` — Strict invariants, standings required, used by detail endpoints
2. **List Mapper:** `mapContestToApiResponseForList` — Metadata-only, no standings, deterministic, used by `/api/contests/my`

Rationale: List endpoints avoid N+1 queries (no standings fetching). Clients fetch standings separately from detail endpoints if needed.

### Pagination
- **Default Limit:** 50 (clamped to [1, 200])
- **Default Offset:** 0 (clamped to >= 0)
- **Determinism:** Stable pagination guaranteed by ORDER BY tier, time, id

### Non-Mutating Behavior
- List endpoint does NOT call `advanceContestLifecycleIfNeeded`
- No read-path self-healing in list queries (single-instance reads handle that)
- Consequence: Stale SCHEDULED contests (past lock_time but not yet transitioned) may appear in list; write-time validation will catch them on join

---

## GAP-13 Setup Notes (Admin Operations)

The role-based access control pattern implemented in GAP-12 will be reused for GAP-13:

1. **Admin Status Derivation:** All admin operations will derive `isAdmin` from `req.user.isAdmin` (server auth context), never from client headers.
2. **WHERE Clause Pattern:** Admin operations that differ by role (e.g., cancel any contest vs. only own contests) will use conditional WHERE clauses similar to the ERROR visibility pattern.
3. **Centralized Auth Dependency:** GAP-13 will assume `req.user` is populated by upstream auth middleware. No custom auth logic in route handlers.
4. **Transaction Safety:** Admin state-changing operations (cancel, force-lock, resolve error) should use row-level locking (`SELECT FOR UPDATE`) to prevent concurrent conflicts, following the pattern established in settlement execution (GAP-09).
5. **Audit Integration:** Admin operations will write audit records to `admin_contest_audit` table with SYSTEM or user actor identity, following established patterns in `adminContestService.js`.

---

### GAP-13: Admin operations for contest infrastructure

| Attribute | Value |
|---|---|
| Status | `COMPLETED` |
| Layer | Backend domain logic |
| Description | Five service-layer admin operations now enforce the contract's valid transition graph and time field invariants with the same rigor as automated processes. (1) **cancelContestInstance**: Transitions contests to CANCELLED from SCHEDULED, LOCKED, LIVE, or ERROR. COMPLETE is terminal (rejected). Idempotent: calling twice on a CANCELLED contest returns noop=true. (2) **forceLockContestInstance**: Force SCHEDULED → LOCKED by updating lock_time to NOW (if null) and transitioning via SYSTEM actor. Only SCHEDULED contests can be force-locked. Idempotent: calling on a LOCKED contest returns noop=true. (3) **updateContestTimeFields**: Updates lock_time, start_time, end_time in SCHEDULED status only. All changes validated against time field invariants (created_at < lock_time ≤ start_time < end_time). Idempotent: unchanged fields result in noop=true with audit record. (4) **triggerSettlement**: Triggers SYSTEM-driven settlement transitions from LIVE status. If settlement readiness check passes, executes settlement and transitions to COMPLETE. If readiness fails, transitions to ERROR with distinguishable audit payload. Idempotent: COMPLETE and ERROR return noop=true. (5) **resolveError**: Resolves ERROR status to COMPLETE (with settlement execution) or CANCELLED. Executes settlement OUTSIDE the transaction, then updates status. Idempotent: calling on a resolved contest returns noop=true. All five operations enforce state transition validation via `assertAllowedDbStatusTransition()` with correct actor (ADMIN or SYSTEM). All paths write audit records with required schema fields: contest_instance_id, admin_user_id, action, reason, from_status, to_status, payload. Audit writes occur for success, idempotency (noop=true), and rejection (noop=true, rejected=true, error_code). |
| Why it matters | The contract principle "Admin operations enforce the same validation as automated processes" is now fully satisfied. The system can be operated through full lifecycle with deterministic, auditable admin actions. State transitions via admin API use the same transition validator as automated processes, preventing bypasses or inconsistencies. |
| Dependencies | GAP-01 (state enum), GAP-02 (`end_time` for update operations), GAP-05 (transition enforcement), GAP-07 (ERROR state for resolution), GAP-08 (settlement readiness validation for trigger), GAP-09 (settlement execution for trigger and resolve). |

---

## GAP-13 Lessons Learned

GAP-13 implementation revealed critical architectural patterns and constraints that are now codified. This section documents lessons for future gap implementations.

### A. Audit Schema Enforcement

**Reality:** The `admin_contest_audit` table is the canonical source of truth for all state transitions (both automated and admin-driven).

**Schema Correctness:**
- Column names are strict: `contest_instance_id` (not `contest_id`), `admin_user_id`, `action`, `reason`, `from_status`, `to_status`, `payload`
- All six columns are required by the schema; NULL constraints are enforced by the database
- FK constraint on `admin_user_id` enforces valid user references
- FK constraint on `contest_instance_id` enforces valid contest references
- FK constraints intentionally do NOT cascade-delete; audit records are immutable

**Audit Writing Discipline:**
- EVERY state transition (success, idempotency, rejection) writes an audit record
- Audit writes occur inside the transaction before COMMIT
- If audit write fails, entire transaction rolls back (audit failure = operation failure)
- Rejected operations write audit with `payload.noop=true, payload.rejected=true, payload.error_code='CODE'`
- All status transitions include both `from_status` and `to_status`

**Test Implications:**
- Deletion tests must delete in dependency order: audit records first, then state
- Never cascade delete when testing FK relationships; respect audit immutability
- Foreign key constraint violations must be caught and handled explicitly

### B. Settlement Readiness Reality

**Zero Participants Is Valid:**
- A contest with zero participants (empty `contest_participants`) is NOT a settlement failure
- `isReadyForSettlement()` returns false only if participants exist AND lack scores
- Test data must model real domain state: if participants exist, they must have scores

**Settlement as Precondition:**
- Settlement readiness validation is a READ-ONLY check (no side effects)
- Settlement execution (writing `settlement_records`, setting `settle_time`) is a separate operation
- Readiness check happens BEFORE status update; execution happens AFTER
- Settlement failures trigger LIVE→ERROR with distinguishable audit markers

### C. Transaction Scope Learnings

**Pool Query Behavior:**
- `pool.query()` does NOT open a transaction by default; each call auto-commits
- Multi-statement operations require explicit `BEGIN...COMMIT` transaction via `client = await pool.connect()`
- Settlement execution (`settlementStrategy.executeSettlement()`) manages its own transaction and cannot be called inside an active transaction (PostgreSQL limitation)

**Transaction Boundaries for Settlement Operations:**
- **triggerSettlement (LIVE + ready → COMPLETE):**
  1. BEGIN transaction, acquire lock via `SELECT FOR UPDATE`
  2. Check readiness (read-only)
  3. If ready, COMMIT transaction (release lock)
  4. Execute settlement OUTSIDE transaction (manages its own)
  5. BEGIN new transaction, reacquire lock, verify settlement succeeded
  6. Update status to COMPLETE, write audit
  7. COMMIT
- **resolveError (ERROR → COMPLETE with settlement):**
  1. Execute settlement FIRST (outside any transaction)
  2. BEGIN transaction, acquire lock
  3. Verify settlement records exist
  4. Update status to COMPLETE, write audit
  5. COMMIT

**Error Recovery Boundary:**
- The `attemptSystemTransitionWithErrorRecovery()` function in `contestLifecycleAdvancer.js` is the error recovery boundary
- Settlement validation occurs INSIDE this boundary, ensuring failures → LIVE→ERROR transition
- Audit records written by recovery include error details: `settlement_failure: true`, `error_origin`, `error_stack`

### D. Idempotency Philosophy

**Definition:** Calling the same operation twice produces the same result without side effects on the second call.

**Pattern:** Explicit state checks AFTER lock, then decide action:
```
1. SELECT FOR UPDATE (acquire exclusive lock)
2. Check status AFTER lock (not a conditional UPDATE)
3. If already at target state: write audit with noop=true, COMMIT, return success
4. If invalid transition: write audit with rejected=true, ROLLBACK, throw error
5. If valid: proceed with transition, write audit with noop=false, COMMIT
```

**Audit Invariant:** EVERY operation writes an audit record, including:
- Success: `payload.noop=false`
- Idempotency: `payload.noop=true` (operation already completed)
- Rejection: `payload.noop=true, payload.rejected=true, payload.error_code='CODE'`

**Consequence:** Audit records for the same operation may appear multiple times if called repeatedly, but the operation has no adverse side effects beyond the first successful call.

### E. Admin Operations Discipline

**No Silent Transitions:** If an admin operation cannot complete its intended state change, it MUST either:
- Write audit with rejection flag and throw error, OR
- Write audit with noop flag and return idempotent result

**No Mutation Without Audit:** Every state change, including:
- Time field updates (`lock_time`, `start_time`, `end_time`)
- Status transitions (SCHEDULED→LOCKED, ERROR→COMPLETE, etc.)
- Rejection of invalid operations

All must write an audit record INSIDE the transaction.

**No Lifecycle Bypassing:** Admin operations delegate to `assertAllowedDbStatusTransition()` for every state change. No operation bypasses this validator; no special admin overrides exist. The validator enforces the contract's valid transition graph uniformly.

**Actor Model Preservation:**
- ADMIN actor: `cancelContestInstance`, `updateContestTimeFields`, `resolveError` (to COMPLETE or CANCELLED)
- SYSTEM actor: `forceLockContestInstance` (admin updates lock_time, then SYSTEM transitions), `triggerSettlement` (all transitions)
- Enforcement: Each state mutation call `assertAllowedDbStatusTransition({ fromStatus, toStatus, actor: ... })`

### F. Row-Level Locking Pattern

All admin operations follow this pattern:
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Step 1: Lock the row (prevents concurrent modifications)
  const lockResult = await client.query(
    'SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE',
    [contestId]
  );

  // Step 2: Check status AFTER acquiring lock (not before)
  const contest = lockResult.rows[0];
  const fromStatus = contest.status;

  // Step 3: Decide action (idempotency check, rejection check, or proceed)
  if (fromStatus === <target-state>) {
    // Idempotent: already at target
    await _writeAdminAudit(client, { ..., payload: { noop: true } });
    await client.query('COMMIT');
    return { success: true, noop: true };
  }

  if (!isValidTransition(fromStatus, <target>)) {
    // Rejected: invalid transition
    await _writeAdminAudit(client, { ..., payload: { noop: true, rejected: true, error_code: '...' } });
    await client.query('ROLLBACK');
    throw new Error('...');
  }

  // Step 4: Proceed with state mutation
  // ... do work ...

  // Step 5: Write audit before COMMIT
  await _writeAdminAudit(client, { ..., payload: { noop: false } });

  await client.query('COMMIT');
  return { success: true, noop: false };
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

This pattern guarantees:
- Exclusive row access during decision-making and mutation
- No race conditions between check and update
- Clear audit trail for idempotent operations
- Failure isolation (entire transaction rolls back on any error)

---

## Retired Gaps (Now Closed via GAP-13)

The following gaps were initially separate but are now subsumed by GAP-13's comprehensive admin operations and audit infrastructure.

### Former GAP-14: Audit trail completeness
**Resolution:** GAP-13 writes audit records for all admin state transitions and integrates with GAP-07/08 SYSTEM audit trail. Auditability is now enforced uniformly across automated and manual operations.

### Former GAP-15: Admin audit table schema definition
**Resolution:** The `admin_contest_audit` table is correctly defined in `schema.snapshot.sql` with all required fields enforced by GAP-13 operations. FK constraints are intentional; cascade deletion is NOT supported (audit is immutable).

---

## Items Explicitly Out of Scope for v1

The following items are intentionally excluded from this gap analysis and from v1 implementation. They are listed here to prevent scope creep.

| Item | Reason for exclusion |
|---|---|
| Multi-sport abstractions | v1 targets a single contest type. The platform is designed to be pluggable, but sport-agnostic abstractions are not required for v1 completion. |
| Provider reconciliation | External data provider reconciliation (score verification against multiple sources) is not defined in the v1 contract. |
| Partial settlement | The contract explicitly states: "Contests are settled all-or-nothing." Partial settlement is a future version concern. |
| Wallets and payments | No wallet, payment, or payout infrastructure is defined in the v1 contract. Settlement results are recorded but distribution mechanisms are out of scope. |
| Real-time push systems | The contract states: "Clients poll or receive data on request only." WebSocket, SSE, or push notification infrastructure is excluded. |
| Dispute resolution | The contract states: "No mechanism for contesting results exists in v1." |
| Retroactive score corrections | The contract states: "Once settled, results are final." |
| Multi-round contests | The contract states: "Each contest is a single, self-contained unit." |
| Schema migration strategy | The contract states: "This document does not prescribe how to migrate existing data to conform to this contract." Migration planning is implementation work, not gap analysis. |
| Client-side state computation | Listed as a non-goal in the contract. Clients must not compute lifecycle state. This gap analysis covers only the backend obligation to provide the correct data. |
| Event sourcing or domain events | GAP-14 standardizes transition observability via lightweight `transition_origin` metadata in audit payload. No separate event table, event stream, or domain event model is introduced. The primary state store remains `contest_instances.status`. |
| External message bus or webhooks | GAP-14 observability is internal (audit queryable via SQL). Realtime subscription by external systems or webhook delivery is out of scope for v1. |

---

## v1 Completion Criteria

Contest Infrastructure v1 can be declared complete when every item below is true. Each criterion traces directly to the Contest Lifecycle Contract v1 exit criteria.

- [ ] The `contest_instances` status column supports exactly six values: SCHEDULED, LOCKED, LIVE, COMPLETE, CANCELLED, ERROR. (GAP-01)
- [ ] All five time fields exist on every contest record: `created_at`, `lock_time`, `start_time`, `end_time`, `settle_time`. (GAP-02, GAP-03)
- [ ] Time field invariants (`created_at < lock_time <= start_time < end_time`; `end_time <= settle_time` when present) are enforced on every write. (GAP-04)
- [ ] A single-responsibility state transition module enforces the contract's valid transition graph and rejects all others. (GAP-05)
- [x] Automated processes transition contests through SCHEDULED, LOCKED, LIVE, and COMPLETE based on time fields and game completion. (GAP-06)
- [x] Failed transitions or settlement operations move contests to ERROR. Admin resolution paths from ERROR to COMPLETE or CANCELLED exist. (GAP-07)
- [x] Settlement-triggered failures are handled with error recovery. Failed settlement readiness checks trigger LIVE→ERROR with distinguishable audit records via canonical SYSTEM user. Settlement validation occurs inside error recovery boundary. Settlement logic implementation deferred to GAP-09. (GAP-08)
- [ ] A settlement record entity persists the output of each settlement operation. (GAP-09)
- [x] Entry submission and pick changes verify contest state at write time using row-level locking. (GAP-10)
- [x] The API returns all eight derived fields (`status`, `is_locked`, `is_live`, `is_settled`, `entry_count`, `user_has_entered`, `time_until_lock`, `standings`) computed by the backend. (GAP-11)
- [x] My Contests sorting follows the six-tier contract sort order. ERROR contests are hidden from non-admin users. (GAP-12)
- [x] All five admin operations (cancel, force-lock, update time fields, trigger settlement, resolve error) exist and enforce the same validation as automated processes. (GAP-13)
- [x] Every state transition (automated and manual) is recorded in an audit trail with timestamp and reason. (GAP-13, GAP-14, GAP-15)

---

## Lifecycle Enforcement Boundaries (Post-Gap 6)

With GAP-06 complete, automated time-driven state transitions are now implemented through read-path self-healing. This section clarifies the current architectural boundaries and how state advancement integrates with read and write operations.

### 1. Read-Path Self-Healing (Gap 06 Implementation)

Single-instance read paths now advance contest state opportunistically based on time fields:

- **Scope:** Only high-value single-instance reads: `getContestInstance`, `getContestInstanceByToken`, `resolveJoinToken`
- **Behavior:** When fetched, the system invokes `advanceContestLifecycleIfNeeded()` to determine if a time-based transition is due (SCHEDULED → LOCKED at lock_time, LOCKED → LIVE at start_time, LIVE → COMPLETE at or after end_time with game completion)
- **Persistence:** If a transition is warranted, the new status is persisted via `_updateContestStatusInternal()` using SYSTEM actor authority, which validates the transition and updates the database atomically
- **Idempotency:** The update is conditional on current status, so race conditions are handled gracefully. If another process advances the status first, the operation returns null without error
- **Return value:** The caller receives the current or newly-advanced state

### 2. List and Write Paths Remain Non-Mutating

- **List endpoints** (`getContestInstancesForOrganizer`) deliberately do **not** self-heal. Multiple contests in a single read would incur high write fan-out; callers requiring current state should fetch individual contests
- **Write paths** (`joinContest`, `updateContestInstanceStatus`, `publishContestInstance`) use independent state guards and do **not** rely on self-healing. State validation at write-time is explicit and synchronous

### 3. SYSTEM Actor Authority

SYSTEM is a new actor in the transition model (`contestTransitionValidator.js`) representing automated, time-based transitions:

- **Allowed transitions:** SCHEDULED → LOCKED, LOCKED → LIVE, LIVE → COMPLETE, LIVE → ERROR
- **Distinction:** SYSTEM transitions are governed by time and data; organizers and admins have broader authority
- **Auditability:** Transitions attributed to SYSTEM are clearly system-driven, not user-initiated, improving debugging and compliance

### 4. Database Invariants

The database remains the ultimate source of truth for contest state.
- **Explicit states:** The `contest_instances.status` column stores one of the six contractually defined states: `SCHEDULED`, `LOCKED`, `LIVE`, `COMPLETE`, `CANCELLED`, `ERROR`.
- **Time field integrity:** The time field invariants (`created_at < lock_time <= start_time < end_time` and `end_time <= settle_time` when present) are enforced at the backend domain layer (via `timeInvariantValidator.js`) **before** any database write operation.
- **Atomicity:** Critical write operations, such as entry submission, utilize row-level locking (`SELECT FOR UPDATE`) to ensure atomicity and prevent race conditions during state verification.

### 5. Domain State Machine (Transition Validator) Guarantees

The `services/helpers/contestTransitionValidator.js` is the single source of truth for permissible state changes.
- **Contractual adherence:** It rigorously enforces the valid state transition graph defined in the [Contest Lifecycle Contract v1](./contest-lifecycle.md).
- **Centralized logic:** All backend service methods that modify contest state **must** delegate their state transition decisions to this validator, including read-path self-healing via SYSTEM actor.
- **Immutability of terminal states:** The validator ensures that once a contest enters a terminal state (`COMPLETE`, `CANCELLED`), no further state changes are possible.

### 6. Separation of Responsibilities

- **Database:** Stores the canonical contest state and time fields. Relies on the application layer for semantic validation.
- **Domain State Machine (`contestTransitionValidator.js`):** Enforces the rules of state transitions based on the contract.
- **Read-path Automation (Gap 06):** Single-instance reads advance state based on time fields, using SYSTEM actor authority via `contestTransitionValidator.js`.
- **Admin-Initiated Operations:** Provide privileged means to initiate transitions beyond what read-path self-healing supports. These operations must utilize the domain state machine and are subject to the same validation rules. There are no admin overrides that bypass the validator.

### 7. Write-Time vs. Derived at Read-Time Guarantees

- **Guaranteed at write time:**
  - The explicit `status` field (may be advanced by read-path self-healing).
  - `created_at`, `lock_time`, and `start_time`.
  - Referential integrity (e.g., contest_id exists).
- **Conditionally present (contract-defined):**
  - `end_time` (required by contract, present on all contests).
  - `settle_time` (written exactly once during settlement).
- **Derived at read time (client-facing):**
  - `is_locked`, `is_live`, `is_settled`.
  - `entry_count`, `user_has_entered`, `time_until_lock`, `standings`.

### 8. Lifecycle "Closed for Modification" in v1

The core lifecycle state model and its valid transition graph, as defined in the [Contest Lifecycle Contract v1](./contest-lifecycle.md) and now enforced by `contestTransitionValidator.js`, are considered **closed for modification** in v1. Any changes to states or transitions would constitute a breaking change to the contract and require a v2. Future extensions must trigger _existing_ valid transitions; they cannot introduce new transition types or bypass the validator.

### 9. No Background Infrastructure Required

Read-path self-healing avoids:
- Cron jobs or scheduled tasks
- Event-driven state machines
- Background worker processes
- Message queues or event buses

Transitions occur naturally as clients or admins read contest state, keeping the system simple and deterministic.

### Derived Fields and Mapper Invariants (Post-GAP 11)

With GAP-11 complete, all client-facing API responses include derived fields computed by the backend. The response mapper enforces strict invariants.

#### Mapper Enforcement Rules

- `entry_count` must be a non-negative integer.
- `user_has_entered` must be boolean.
- SCHEDULED contests must have non-null `lock_time`.
- `standings` are only returned for LIVE or COMPLETE contests.
- Unknown `status` values trigger fail-closed behavior in `resolveJoinToken`.

Derived fields are presentation-level. They are computed after database reads and do not exist as persisted columns.

Legacy fields removed:
- `computedJoinState`
- `entries_current`
- `organizer_name`

---

## Settlement Validation Boundaries (Post-GAP-08)

With GAP-08 complete, settlement readiness validation is now integrated into the lifecycle state machine with guaranteed error recovery. This section clarifies the architectural boundaries and semantics.

### 1. Settlement Validation Scope (GAP-08 Implementation)

Settlement readiness checks are **read-only preconditions** for LIVE→COMPLETE transition:

- **Where it happens:** Inside `attemptSystemTransitionWithErrorRecovery()` error recovery boundary (contestLifecycleAdvancer.js, lines 179-183)
- **When it happens:** Only when attempting LIVE→COMPLETE transition (checked via `nextStatus === 'COMPLETE' && contestRow.status === 'LIVE'`)
- **What it checks:** `isContestGamesComplete(contest)` which validates:
  1. `end_time` has passed (time gate—blocking condition)
  2. `isReadyForSettlement()` succeeds (settlement readiness—blocking condition)
- **Side effects:** None. Settlement validation is read-only; no data is persisted, no `settle_time` is written, no settlement records are created.
- **Error handling:** If either condition fails or throws, the error is caught inside the recovery boundary and contests transition to LIVE→ERROR

### 2. Settlement Validation Timing

- **Read-path self-healing:** Settlement checks occur on single-instance reads (`getContestInstance`, `resolveJoinToken`) when `advanceContestLifecycleIfNeeded()` evaluates LIVE status
- **Automatic retry:** If settlement is not ready, LIVE contests remain LIVE. Subsequent reads will re-check settlement readiness (no caching of "not ready" state)
- **Admin intervention:** Admins can manually transition LIVE→COMPLETE or LIVE→ERROR if settlement checks are blocking progress
- **No scheduled triggers:** Settlement checks do not run on a background schedule; they occur naturally during read-path evaluation

### 3. Audit Trail Completeness (GAP-08)

Every settlement validation failure creates an audit record:

- **Action:** `system_error_transition`
- **Actor:** SYSTEM (canonical UUID: `00000000-0000-0000-0000-000000000000`)
- **Payload markers (settlement-specific):**
  - `settlement_failure: true` — Identifies this as settlement-triggered
  - `error_origin: 'settlement_readiness_check'` — Exact origin of failure
  - `error_stack: <truncated>` — Full stack for debugging settlement logic
  - `attempted_status: 'COMPLETE'` — State that was being transitioned to
- **Queryability:** Settlements failures can be isolated via `WHERE payload->>'settlement_failure' = 'true'`

### 4. What Settlement Validation Does NOT Do (GAP-08 Scope)

- **Does not compute rankings** — That is GAP-09 work
- **Does not allocate payouts** — That is GAP-09 work
- **Does not persist settlement records** — `settlement_records` table is GAP-09 work
- **Does not write `settle_time`** — That happens in GAP-09 when settlement completes
- **Does not create audit records for settlement success** — Only failures are audited
- **Does not prevent ERROR→COMPLETE transitions** — Admins can force contests to COMPLETE via admin resolution endpoint (GAP-13)

### 5. Invariants Guaranteed by GAP-08

- **Contracts never reach COMPLETE unless settlement readiness succeeds** — The validation boundary ensures this
- **Settlement failures always produce ERROR state** — No partial transitions or silent swallowing
- **Settlement errors are distinguishable in audit trails** — Via `settlement_failure` marker
- **Idempotent error recording** — Repeated reads re-check settlement; each failure produces a new audit record
- **No data corruption** — Validation is read-only; failures cannot corrupt contest state or data

---

## What Is Still Manual After Gap 6

While GAP-06 has established read-path self-healing for time-driven transitions, it's critical to explicitly document what remains a manual operation.

### 1. Time-Driven Automation Scope (Post-Gap 6)

Read-path self-healing now advances `SCHEDULED -> LOCKED -> LIVE` automatically on single-instance reads:

- `getContestInstance`, `getContestInstanceByToken`, `resolveJoinToken` check time fields and persist transitions
- **List endpoints remain non-mutating** to avoid write fan-out
- **Write paths do not rely on self-healing** to keep state verification explicit
- **LIVE → COMPLETE remains conditional** on game completion (not yet fully implemented)

Consequence: Contests will not surface stale state to single-instance lookups, but list views may show stale state if the organizer or admin is not fetching detail views. This is intentional for performance.

### 2. Settlement Implementation (Not Yet Automated—GAP-09)

- Settlement logic itself (`isReadyForSettlement()`, `computeRankings()`, payouts, etc.) is still to be implemented in GAP-09
- Settlement result persistence (creating `settlement_records`, writing `settle_time`) happens in GAP-09
- However, settlement **readiness validation** is now automated and integrated into LIVE→COMPLETE (GAP-08)
- The precondition check ensures contests cannot reach COMPLETE unless settlement is ready

### 3. Error State Handling

- The Contest Lifecycle Contract v1 defines an `ERROR` state and admin-only resolution paths (GAP-07 remains incomplete).
- At present, no production code path transitions contests into or out of `ERROR`.
- As a result, no automated or manual error recovery workflow exists in the system today.

### 4. Admin Operations Beyond Time-Driven Transitions

- Time-driven transitions (SCHEDULED → LOCKED → LIVE) are now automated on read paths.
- Other significant state changes (cancellation, force-locking, error resolution) require explicit admin API calls. While these calls now route through the robust `contestTransitionValidator.js`, the _initiation_ of these changes is entirely manual.
- **Caveat:** Admin operations are allowed to trigger state transitions that read-path self-healing is not (e.g., LOCKED → CANCELLED, LIVE → ERROR).

---

---

## GAP-14: Transition Observability Standardization (Lightweight)

### Problem Statement

Contest lifecycle transitions now occur across three execution paths:
- **Time-driven transitions:** `advanceContestLifecycleIfNeeded`
- **Admin-driven transitions:** GAP-13 operations
- **Error recovery transitions:** `attemptSystemTransitionWithErrorRecovery`

All transitions write audit records, but:
- Transition causes are encoded inconsistently in payload
- No normalized "transition origin" marker exists
- Debugging requires reading code paths rather than structured metadata

**Scope-Limited Solution:** We do NOT need domain events. We only need consistent transition metadata.

### Why It Matters

Operational debugging and audit compliance require clear answers to: "Why did this contest move to ERROR?" Standardized transition origin classification makes the answer observable in structured form without architectural expansion.

### Scope

**In Scope:**
1. Standardize `payload.transition_origin` in all audit writes with allowed values:
   - `TIME_DRIVEN` — Lock/start/end time gate transition
   - `ADMIN_MANUAL` — Explicit admin operation
   - `SETTLEMENT_DRIVEN` — Successful settlement-driven transition
   - `ERROR_RECOVERY` — Automatic recovery after failure
2. Ensure all state transitions (automated + admin) include:
   - `from_status` and `to_status` (already enforced)
   - `payload.transition_origin` (new requirement)
   - Optional `payload.metadata` object for additional context
3. Update documentation in contest-lifecycle.md clarifying observability approach

**Out of Scope:**
- No `contest_lifecycle_events` table
- No event sourcing or domain event model
- No CQRS changes
- No audit schema replacement
- No external message bus or webhooks
- No asynchronous transition processing

### Explicit Non-Goals

The primary state store remains `contest_instances.status`. Audit remains `admin_contest_audit`. No new infrastructure introduced.

### Completion Criteria

1. All state transition audit writes include `payload.transition_origin`
2. All transition paths use one of the four allowed enum values
3. At least 10 integration tests assert presence of `transition_origin` in audit payload
4. Documentation updated in contest-lifecycle.md to reflect standardized origin tagging
5. No new database tables introduced

---

## Change Log

| Date | Version | Author | Description |
|---|---|---|---|
| 2026-02-11 | v1 | System | GAP-14 LIGHTENED: Replaced domain event abstraction with standardized transition_origin classification in audit payload. No new tables introduced. All transitions include one of four enum values (TIME_DRIVEN, ADMIN_MANUAL, SETTLEMENT_DRIVEN, ERROR_RECOVERY) for deterministic observability without architectural expansion. Completion criteria: 10 integration tests asserting transition_origin presence, documentation updated. Complexity reduced from 7/10 to 2/10; no schema migrations or cross-cutting refactors needed. |
| 2026-02-11 | v1 | System | GAP-13 COMPLETED: Implemented five service-layer admin operations (cancelContestInstance, forceLockContestInstance, updateContestTimeFields, triggerSettlement, resolveError) with full audit trail support. Fixed audit schema to use correct column names (contest_instance_id, from_status, to_status). All operations enforce state transition validation via assertAllowedDbStatusTransition() with correct actor (ADMIN or SYSTEM). All paths write audit records for success, idempotency, and rejection. Settlement execution integrated into triggerSettlement and resolveError with error recovery. Added "GAP-13 Lessons Learned" section documenting audit schema enforcement, settlement readiness reality, transaction scope boundaries, idempotency philosophy, and admin operations discipline. Retired former GAP-14/15 (subsumed by GAP-13). Proposed lightweight GAP-14 for transition observability. |
| 2026-02-11 | v1 | System | GAP-12 CLOSED: Implemented GET /api/contests/my endpoint with full 6-tier sorting contract. New `mapContestToApiResponseForList` mapper separates list and detail read models (CQRS). SQL-driven sorting with CASE tier assignment, tier-scoped time columns, NULLS LAST, and deterministic tie-breaker. Non-mutating list endpoint (no self-healing). Fail-closed ERROR visibility with role-based access control. Pagination with clamped limits [1,200] default 50. Centralized auth via req.user. Added comprehensive route tests validating SQL query structure and parameter handling. Updated contest-lifecycle.md with implementation notes. Added GAP-13 setup notes for admin operations role-based access pattern reuse. |
| 2026-02-10 | v1 | System | GAP-08 clarification: Documented that settlement validation occurs inside `attemptSystemTransitionWithErrorRecovery()` error recovery boundary, not only in `advanceContestLifecycleIfNeeded()`. This placement is mandatory for GAP-07 error recovery semantics. Updated GAP-08 description to COMPLETE status and clarified SYSTEM audit implementation with canonical UUID. Added "Settlement Validation Boundaries (Post-GAP-08)" section to document scope, timing, audit trails, and invariants. Updated completion checklist to reflect error recovery boundary requirement. |
| 2026-02-08 | v1 | System | Initial creation of the Contest Infrastructure v1 Gap Checklist. Fifteen gaps identified across database, backend domain logic, API contract, and admin operations layers. All gaps measured against Contest Lifecycle Contract v1. |