# Contest Lifecycle Contract v1

This document is the authoritative Contest Lifecycle Contract for the Playoff Challenge application. It is system law. All backend logic, API behavior, admin operations, and client integrations must conform to what is defined here. There is no speculative language in this document.

---

## Purpose

This contract defines the complete lifecycle of a contest from creation through settlement or cancellation. It serves as the single reference for:

- What states a contest can occupy.
- What time fields govern transitions.
- How settlement works.
- What the API must return to clients.
- What operations admins may perform.
- What constraints Claude sessions must follow when working on contest-related code.

Any Claude session working on contest logic must read this file first. No additional context is required.

---

## Non-Negotiable Principles

1. **Backend is the source of truth.** The database and backend logic determine contest state. Clients never compute, infer, or derive lifecycle state.
2. **State is explicit.** Every contest has a single, stored lifecycle state. There are no implicit or computed states.
3. **Time fields are server-authoritative.** All timestamps are set and evaluated by the backend. Clients display them but never act on them independently.
4. **Settlement is a discrete operation.** Settlement is not a side effect. It is an explicit, auditable backend action.
5. **Idempotency.** State transitions that have already occurred must not produce errors when re-triggered. The system must be safe to retry.
6. **No silent failures.** If a state transition fails, the contest must move to the ERROR state. Partial transitions are not permitted.
7. **Auditability.** Every state change must be traceable. The backend must record when and why a transition occurred.

---

## Lifecycle States

A contest occupies exactly one of the following states at any time.

| State | Meaning |
|---|---|
| `SCHEDULED` | Contest has been created and is open for entry. Picks may be submitted or changed. The contest has not yet locked. |
| `LOCKED` | The lock time has passed. No new entries or pick changes are permitted. The contest is awaiting its start time. |
| `LIVE` | The contest's underlying games are in progress. Scoring is active. No pick changes are permitted. |
| `COMPLETE` | All games in the contest have finished. Scoring is final. Settlement has been executed. |
| `CANCELLED` | The contest has been cancelled by an admin before completion. Entries are refunded or voided per the settlement model. |
| `ERROR` | A state transition or settlement operation failed. Manual admin intervention is required. The contest is frozen in this state until resolved. |

### Valid State Transitions

```
SCHEDULED  →  LOCKED
SCHEDULED  →  CANCELLED
LOCKED     →  LIVE
LOCKED     →  CANCELLED
LIVE       →  COMPLETE
LIVE       →  ERROR
COMPLETE   (terminal — no further transitions)
CANCELLED  (terminal — no further transitions)
ERROR      →  COMPLETE   (admin resolution only)
ERROR      →  CANCELLED  (admin resolution only)
```

No other transitions are valid. Any attempt to perform an invalid transition must be rejected by the backend.

---

## Time Fields

Every contest has the following time fields. All are stored as UTC timestamps.

| Field | Meaning | Set By |
|---|---|---|
| `created_at` | When the contest record was created. | System, at creation time. Immutable. |
| `lock_time` | When the contest stops accepting entries and pick changes. Transitions the contest from SCHEDULED to LOCKED. | Admin, at creation time. May be updated while in SCHEDULED state only. |
| `start_time` | When the first game in the contest begins. Transitions the contest from LOCKED to LIVE. | Admin, at creation time. May be updated while in SCHEDULED or LOCKED state only. |
| `end_time` | When the last game in the contest concludes. Used to determine when the contest may transition from LIVE to COMPLETE. | Admin, at creation time. May be updated while not in COMPLETE or CANCELLED state. |
| `settle_time` | When settlement was executed. Null until settlement occurs. | System, at settlement time. Immutable once set. |

### Time Field Invariants

These invariants must always hold:

```
created_at  <  lock_time  ≤  start_time  <  end_time
```

`settle_time`, when present, must satisfy:

```
end_time  ≤  settle_time
```

The backend must enforce these invariants on every write operation. No API call or admin action may violate them.

---

## Settlement Model

Settlement is the process of finalizing contest results and distributing outcomes (prizes, standings, records) after all games have concluded.

### Settlement Rules (v1)

1. Settlement may only be executed when the contest is in the `COMPLETE` state.
2. Settlement is idempotent. Running settlement on an already-settled contest produces no change.
3. Settlement must verify that all games in the contest have final scores before proceeding.
4. If any game lacks a final score, settlement must fail and the contest must move to ERROR.
5. Settlement writes the `settle_time` field exactly once.
6. Settlement results are immutable after execution. No retroactive changes are permitted in v1.

### Settlement Version

This is **Settlement Model v1**. Future versions may introduce partial settlement, dispute resolution, or retroactive corrections. Those features are explicitly excluded from v1.

---

## Scoring Service Contract

The scoring service computes fantasy points for individual players based on their game statistics. It is the single source of truth for point calculations and must be pure, deterministic, and replayable.

### Function Signature

```javascript
async function calculateFantasyPoints(pool, stats)
```

### Parameters

- **pool**: PostgreSQL connection pool. Must be injected explicitly. Used to fetch active scoring rules.
- **stats**: Object containing player statistics (e.g., `{ pass_yd: 300, pass_td: 2, rush_yd: 100 }`).

### Return Value

A single numeric value representing total fantasy points, rounded to 2 decimal places. Returns `0` if stats is empty or all values are null/undefined.

### Behavioral Requirements

1. **Must not import server.js.** The function exists in `services/scoringService.js` and is imported directly by callers.
2. **Must not initialize Express.** No app bootstrap, middleware, or route handlers in the scoring service.
3. **Must not create global database connections.** Pool is injected; the service does not create or manage its own connection.
4. **Must return identical output for identical input.** Given the same `(pool, stats)` parameters and the same database state, output must be numerically identical.
5. **Must round to 2 decimal places.** Result must satisfy `decimalPlaces <= 2`.
6. **Must handle null/undefined safely.** Missing stats fields are treated as 0; null or undefined values do not throw errors.
7. **Must be idempotent.** Multiple calls with same inputs produce same output without side effects.
8. **Must not modify input parameters.** The `stats` object passed in must not be mutated.

### Determinism Guarantee

Scoring results are deterministic and replayable. The output depends only on:
- The input stats object
- The active scoring rules in the database (via the injected pool)

Scoring does not depend on:
- System time (beyond the point at which the pool is created)
- Random number generation
- External API calls
- Global state
- Cache state (each call fetches fresh rules)

This determinism is critical for settlement auditability: when settling a contest, the same set of stats always produces the same point totals, regardless of when settlement is executed.

### Testing Guarantees

- All unit tests use `mockPool` with mock scoring rules.
- Unit tests never require the real `server.js` module.
- No real database connections are created in test environment.
- No open handles remain after test completion.
- Tests import `calculateFantasyPoints` directly from `services/scoringService.js`.
- Each test explicitly passes a mock pool: `calculateFantasyPointsFunc(mockPool, stats)`.

### Example Usage

```javascript
// In production/integration context
const { calculateFantasyPoints } = require('./services/scoringService');
const points = await calculateFantasyPoints(pool, { pass_yd: 300, pass_td: 2 });

// In unit tests
const { calculateFantasyPoints } = require('../../services/scoringService');
const mockPool = createMockPool();
const points = await calculateFantasyPoints(mockPool, { pass_yd: 300, pass_td: 2 });
```

---

## Derived Fields Returned to Clients

Clients receive contest data through the API. The following fields are derived by the backend and included in API responses. Clients must not compute these independently.

| Field | Derivation |
|---|---|
| `status` | The current lifecycle state of the contest, as stored in the database. |
| `is_locked` | True if the contest is in any state other than SCHEDULED. Derived from state, not from comparing `lock_time` to the current time. |
| `is_live` | True if the contest is in the LIVE state. |
| `is_settled` | True if `settle_time` is not null. |
| `entry_count` | The number of entries in the contest. Computed by the backend. |
| `user_has_entered` | Whether the requesting user has an entry. Computed per-request by the backend. |
| `time_until_lock` | Seconds remaining until `lock_time`. Computed by the backend at response time. Null if already locked. |
| `standings` | Ordered list of entries by score. Only included when the contest is LIVE or COMPLETE. Computed by the backend. |

Clients render what the API returns. If a field is absent, the client must treat it as unavailable — not as a default value.

### Contest Share Capability

The `actions.can_share_invite` field determines whether a user can share a contest link with others. This capability is **NOT exclusive to the organizer** but is **lifecycle-aware for ERROR containment**.

**Sharing Rules:**
- `can_share_invite = true` when:
  - `authenticatedUserId != null` (user is authenticated), AND
  - `contest.status != 'ERROR'` (contest is not in system error state)
- `can_share_invite = false` when:
  - `authenticatedUserId = null` (unauthenticated/guest), OR
  - `contest.status = 'ERROR'` (system failure state)

**Lifecycle Alignment:**
- **SCHEDULED, LOCKED, LIVE:** Shareable. Contest is in normal operation or promotion phase.
- **COMPLETE:** Shareable. Final, controlled business outcome. Results may be distributed.
- **CANCELLED:** Shareable. Cancelled is a controlled administrative decision, not a system failure.
- **ERROR:** NOT shareable. System failure state must not be virally propagated.

**Rationale for ERROR Containment:**
ERROR represents an uncontrolled system state (failed settlement, data integrity issue, or operational failure). ERROR contests expose incomplete or unstable UI states and broken game data. Preventing share during ERROR:
1. Contains system failures to known participants
2. Prevents viral distribution of broken state
3. Ensures ERROR resolution occurs before expansion
4. Protects system integrity and operational trust

COMPLETE and CANCELLED are controlled outcomes and may be shared without risk.

**Management Rules (distinct from sharing):**
- `can_manage_contest = true` only for the contest organizer (creator)
- Management capabilities (editing, cancellation, resolution) remain organizer-exclusive
- Organizers retain manage capability in ERROR state to resolve and recover

**Backend Authority:**
- The backend is the sole authority for both fields. No client inference is permitted.
- iOS and all clients must gate the share UI directly on `actions.can_share_invite == true`.
- No client shall infer share capability from user role, entry state, capacity, or any other field.

**Governance Invariant:**
`can_share_invite` depends ONLY on `authenticatedUserId` and `contest.status`. It is immune to:
- User entry state (`user_has_entered`)
- Capacity conditions (`entry_count`, `max_entries`)
- Leaderboard state
- Join eligibility or other context variables

**Rationale (Broadened):**
Sharing is a lightweight, non-privileged action that amplifies contest visibility and participation. Restricting it to organizers would artificially limit network effects. ERROR containment is the only lifecycle gate, balancing openness with system integrity.

### Mapper Invariants and Validation

All derived fields are validated by the backend response mapper.

- `entry_count` must be numeric.
- `user_has_entered` must be boolean.
- SCHEDULED requires non-null `lock_time`.
- `standings` returned only for LIVE or COMPLETE.
- Unknown `status` values trigger fail-closed join behavior.

---

## Authoritative API Contract

### Contest List (My Contests)

The "My Contests" view returns all contests the requesting user has entered, plus any SCHEDULED contests open for entry.

**Sorting rules:**

1. LIVE contests first, sorted by `end_time` ascending (soonest ending first).
2. LOCKED contests second, sorted by `start_time` ascending.
3. SCHEDULED contests third, sorted by `lock_time` ascending (soonest locking first).
4. COMPLETE contests fourth, sorted by `settle_time` descending (most recently settled first).
5. CANCELLED contests last, sorted by `created_at` descending.
6. ERROR contests are not shown to non-admin users.

#### Implementation Notes (GAP-12 CLOSED)

**Endpoint:** `GET /api/contests/my`

**Scope:** Contests where user is a participant (`EXISTS in contest_participants`) OR status = SCHEDULED.

**Data Layer (SQL):** Sorting is entirely SQL-driven using CASE tier assignment (tier 0-5). Each tier has its own time column (CASE-scoped), preventing inactive tiers from affecting sort order. NULLS LAST prevents null values from disrupting deterministic ordering. Final tie-breaker: `ci.id ASC`.

**Response Layer:** Uses `mapContestToApiResponseForList` mapper (list-focused, metadata-only). This mapper deliberately omits standings to avoid N+1 query patterns. Clients fetch standings separately from detail endpoints if needed. This is a CQRS-style read model separation: detail endpoints use `mapContestToApiResponse` (strict standings invariant), list endpoints use `mapContestToApiResponseForList` (no standings requirement).

**Pagination:** Clamped limit [1, 200] default 50; offset >= 0 default 0. Deterministic due to SQL ORDER BY.

**Non-Mutating:** This endpoint does NOT trigger lifecycle advancement. Single-instance reads handle self-healing via read-path advancement. Stale SCHEDULED contests (past lock_time) may appear in the list; write-time validation will catch them on join attempt.

**ERROR Handling:** WHERE clause uses `($isAdmin = true OR ci.status != 'ERROR')` to fail-closed: non-admin users never see ERROR contests, even if they entered them. This avoids exposing internal failures in user-facing UI. Admin operations (GAP-13) will handle ERROR visibility and recovery.

**Authentication:** `req.user` must be populated by upstream centralized auth middleware. `isAdmin` derived from `req.user.isAdmin === true`, never from client headers.

### Contest Detail

Returns the full contest object including all derived fields listed above. The response shape is identical regardless of lifecycle state; field presence varies as described in the derived fields section.

### Entry Submission

- Permitted only when the contest is in the SCHEDULED state.
- The backend must verify state at the time of the write, not at the time of the request.
- If the contest has transitioned to LOCKED between request receipt and write, the submission must be rejected.

### Pick Changes

- Permitted only when the contest is in the SCHEDULED state.
- Same write-time verification as entry submission.

### Write-Time Validation Order for Pick Operations

All pick submission and modification requests (POST `/api/picks/v2`) are subject to the following strict server-side validation order, ensuring data integrity and preventing race conditions:

1.  **Contest Existence:** The provided `contestInstanceId` must correspond to an existing contest. If not found, the request fails early.
2.  **Participant Validation:** The `userId` must correspond to a valid participant in the specified contest. If the user is not a participant, the request is rejected with an appropriate error.
3.  **Contest Lock State:** The contest's `status` is checked.
    *   If the contest is `LOCKED`, `LIVE`, `COMPLETE`, `CANCELLED`, or `ERROR`, pick submission/modification is rejected. Specifically, `LOCKED` contests return `403 CONTEST_LOCKED`. This validation occurs prior to week alignment checks.
4.  **Week Alignment (WEEK_MISMATCH):** The `weekNumber` provided in the client's payload (`clientWeek`) is compared against the server-derived actual game state week (`serverWeek`). If `clientWeek !== serverWeek`, the system returns `409 WEEK_MISMATCH`. This applies even if the contest is `SCHEDULED` and the user is a valid participant.
5.  **Pick Execution:** If all preceding validations pass, the requested pick operations (add/remove) are executed within a database transaction, including position limits and player eligibility checks.

This precise order ensures that essential lifecycle invariants are protected and client-side logic can reliably interpret server responses.

Write-time lifecycle enforcement is now fully guaranteed for both contest entry (`joinContest`) and pick submission/modification (POST `/api/picks/v2`), as detailed in GAP-10.

---

## Admin Operations Contract (GAP-13 COMPLETED)

Admin operations are privileged actions that modify contest state or configuration. These operations are available only to authenticated admin users.

| Operation | Permitted States | Effect |
|---|---|---|
| Create contest | N/A | Creates a new contest in SCHEDULED state with all required time fields. |
| Update time fields | SCHEDULED only | Modifies lock_time, start_time, or end_time subject to time field invariants. Time invariants enforce: created_at < lock_time ≤ start_time < end_time. Idempotent: unchanged fields return noop=true. |
| Cancel contest | SCHEDULED, LOCKED, LIVE, ERROR | Transitions contest to CANCELLED. COMPLETE is terminal (rejected). Idempotent: calling on a CANCELLED contest returns noop=true. |
| Force-lock contest | SCHEDULED | Transitions contest to LOCKED immediately, updating lock_time to NOW if null. Uses SYSTEM actor for transition (after ADMIN updates lock_time). Idempotent: calling on a LOCKED contest returns noop=true. |
| Trigger settlement | LIVE | Checks settlement readiness. If ready, executes settlement and transitions to COMPLETE. If not ready, transitions to ERROR. Idempotent: COMPLETE and ERROR return noop=true. |
| Resolve error | ERROR | Transitions contest to COMPLETE (with settlement execution) or CANCELLED. For COMPLETE, settlement is executed OUTSIDE the transaction, then status is updated. Idempotent: calling on a resolved contest returns noop=true. |

### Admin Operations Implementation Details (GAP-13)

All five admin operations enforce the same state transition rules and time field invariants as automated processes. There are no admin overrides that bypass validation in v1.

**Shared Implementation Patterns:**

1. **Row-Level Locking:** All operations use `SELECT ... FOR UPDATE` to acquire an exclusive row lock, preventing concurrent modifications during decision-making and state mutation.

2. **State Checks After Lock:** Status is checked AFTER acquiring the lock, not before. This prevents race conditions between validation and mutation.

3. **Audit Trail Discipline:** Every operation writes an audit record inside the transaction:
   - Success: `payload.noop=false`
   - Idempotency: `payload.noop=true` (operation already completed)
   - Rejection: `payload.noop=true, payload.rejected=true, payload.error_code='CODE'`
   - All records include required fields: `contest_instance_id`, `admin_user_id`, `action`, `reason`, `from_status`, `to_status`, `payload`

4. **Transition Validation:** All status changes call `assertAllowedDbStatusTransition()` with the correct actor (ADMIN or SYSTEM) before UPDATE:
   - `cancelContestInstance`: ADMIN actor
   - `forceLockContestInstance`: SYSTEM actor (for the transition; ADMIN updates lock_time)
   - `updateContestTimeFields`: No transition (no state change)
   - `triggerSettlement`: SYSTEM actor (all transitions via this operation)
   - `resolveError`: ADMIN actor

5. **Idempotency Semantics:** Calling the same operation twice produces the same result without adverse side effects beyond the first call. Idempotent calls return `noop=true` with audit record.

6. **Settlement Execution Boundaries (triggerSettlement, resolveError):**
   - Settlement logic manages its own transaction and cannot be called inside an active transaction (PostgreSQL limitation)
   - **triggerSettlement (LIVE + ready → COMPLETE):**
     1. BEGIN transaction, acquire lock, check readiness
     2. If ready, COMMIT (release lock)
     3. Execute settlement OUTSIDE transaction
     4. BEGIN new transaction, reacquire lock, update status
   - **resolveError (ERROR → COMPLETE with settlement):**
     1. Execute settlement FIRST (outside any transaction)
     2. BEGIN transaction, acquire lock, verify settlement succeeded
     3. Update status

### Transition Origin Classification (GAP-14)

All lifecycle state transitions include a standardized `transition_origin` field in audit payload for deterministic observability:

| Origin | Description |
|---|---|
| `TIME_DRIVEN` | Lock time, start time, or end time gate transition via read-path self-healing |
| `ADMIN_MANUAL` | Explicit admin operation (cancelContestInstance, forceLockContestInstance, updateContestTimeFields, triggerSettlement, resolveError) |
| `SETTLEMENT_DRIVEN` | Successful settlement-driven transition (LIVE→COMPLETE when settlement is ready and executed) |
| `ERROR_RECOVERY` | Automatic recovery after failure (LIVE→ERROR when settlement readiness check fails or other errors occur) |

**Usage:**
```sql
-- Find all contests that transitioned to ERROR due to settlement failure
SELECT * FROM admin_contest_audit
WHERE action = 'system_error_transition'
  AND payload->>'transition_origin' = 'ERROR_RECOVERY'
ORDER BY created_at DESC;

-- Find all admin-triggered LIVE→CANCELLED transitions
SELECT * FROM admin_contest_audit
WHERE action = 'cancel_contest'
  AND from_status = 'LIVE'
  AND payload->>'transition_origin' = 'ADMIN_MANUAL'
ORDER BY created_at DESC;
```

This enables deterministic observability without introducing a domain event system. No separate lifecycle event table exists in v1.

---

## Safe Schema Map

This section describes the conceptual data model. It does not assert exact table names, column names, or data types. Implementation must verify actual schema before writing code.

### Contest Entity

Represents a single contest instance.

- **Identifier**: Unique contest ID.
- **Display name**: Human-readable contest name.
- **Lifecycle state**: One of the six defined states.
- **Time fields**: `created_at`, `lock_time`, `start_time`, `end_time`, `settle_time`.
- **Configuration**: Entry fee, prize structure, contest type, max entries. Specifics are implementation-dependent.

### Entry Entity

Represents a user's participation in a contest.

- **Identifier**: Unique entry ID.
- **Contest reference**: Links to the parent contest.
- **User reference**: Links to the entering user.
- **Picks**: The set of selections made by the user. Structure is implementation-dependent.
- **Score**: Computed score based on game outcomes. Null until scoring begins.
- **Rank**: Position in standings. Null until standings are computed.
- **Timestamps**: When the entry was created and last modified.

### Game Entity

Represents a real-world game that a contest tracks.

- **Identifier**: Unique game ID.
- **Contest reference**: Links to the parent contest (may be many-to-many).
- **Scheduled time**: When the game is expected to start.
- **Status**: Whether the game is scheduled, in progress, or final.
- **Score**: The current or final score. Null until the game starts.

### Settlement Record Entity

Represents the output of a settlement operation.

- **Identifier**: Unique settlement ID.
- **Contest reference**: Links to the settled contest.
- **Timestamp**: When settlement was executed.
- **Results**: Per-entry outcomes (rank, payout, etc.). Structure is implementation-dependent.

---

## Explicit Non-Goals

The following are explicitly out of scope for v1 of this contract:

1. **Partial settlement.** Contests are settled all-or-nothing.
2. **Retroactive score corrections.** Once settled, results are final.
3. **Multi-round contests.** Each contest is a single, self-contained unit.
4. **Real-time push notifications.** Clients poll or receive data on request only.
5. **Client-side state computation.** Clients do not determine lifecycle state under any circumstances.
6. **Dispute resolution.** No mechanism for contesting results exists in v1.
7. **Schema migration guidance.** This document does not prescribe how to migrate existing data to conform to this contract.

---

## Exit Criteria

This contract is considered fully implemented when:

1. Every contest in the system occupies exactly one of the six defined lifecycle states.
2. All state transitions conform to the valid transition graph.
3. All five time fields are present on every contest record and satisfy the stated invariants.
4. Settlement is an explicit, idempotent operation that writes `settle_time` exactly once.
5. The API returns all eight derived fields (status, is_locked, is_live, is_settled, entry_count, user_has_entered, time_until_lock, standings) computed by the backend and enforced by mapper invariants.
6. The "My Contests" sort order matches the defined rules.
7. Admin operations enforce the same validation as automated processes.
8. No client computes, infers, or derives lifecycle state.

---

## Settlement Error Recovery (GAP-08)

### Purpose

Settlement is a critical operation that finalizes contest results. However, settlement logic can fail for various reasons (missing game data, scoring errors, database constraints, etc.). The contract requires "No silent failures" — if settlement fails, contests must transition to ERROR visibly.

### Architecture

Settlement is implemented as a **precondition** for the COMPLETE state, not a post-condition. This ensures contests never reach COMPLETE unless settlement readiness succeeds.

**Critical invariant:** Settlement readiness validation occurs **inside** `attemptSystemTransitionWithErrorRecovery()`, not only in `advanceContestLifecycleIfNeeded()`. This placement is mandatory to guarantee GAP-07 error recovery semantics.

**Integration points:**
- `advanceContestLifecycleIfNeeded()` suggests LIVE → COMPLETE transition (pure function)
- `attemptSystemTransitionWithErrorRecovery()` executes the transition with error boundary
- `isContestGamesComplete()` validates both time gate and settlement readiness (read-only)

**Flow (Detailed):**
1. Read-path self-healing calls `advanceContestLifecycleIfNeeded(contest)` (pure function)
2. For LIVE state, `advanceContestLifecycleIfNeeded()` calls `isContestGamesComplete()` to determine eligibility
3. `isContestGamesComplete()` checks two conditions (either can block):
   - `end_time` has passed (time gate — if not met, returns false)
   - `isReadyForSettlement()` succeeds (settlement readiness — if throws or returns false, blocks transition)
4. If both conditions met, function returns COMPLETE as suggested next status
5. Caller then invokes `attemptSystemTransitionWithErrorRecovery()` with nextStatus='COMPLETE'
6. **Inside the error recovery boundary (lines 179-183):** Validation call to `isContestGamesComplete()` occurs again
   - This call may throw if settlement readiness fails
   - The throw is caught by the try-catch in `attemptSystemTransitionWithErrorRecovery()`
7. If settlement readiness check throws, error recovery catches it and attempts LIVE → ERROR transition
8. Enhanced audit payload marks the failure as settlement-related:
   - `settlement_failure: true`
   - `error_origin: 'settlement_readiness_check'`
   - `error_stack: <full stack trace, truncated to 1000 chars>`
   - `attempted_status: 'COMPLETE'`

**Why settlement validation is inside the error boundary:** This placement ensures that ANY error during settlement readiness checking—including transient database errors, missing game data, or scoring logic failures—is caught and results in a visible ERROR state. Without this boundary, failures would either be swallowed (silent) or leave contests in inconsistent states. The error recovery boundary is the only mechanism that guarantees the "No silent failures" contract principle.

### Current Implementation Status

**Implemented (GAP-08 Complete):**
- ✅ Settlement validation integrated into LIVE→COMPLETE transition via error recovery boundary
- ✅ Validation location: inside `attemptSystemTransitionWithErrorRecovery()` (lines 179-183 of contestLifecycleAdvancer.js)
- ✅ Error handling via existing GAP-07 infrastructure (LIVE → ERROR on failure)
- ✅ Audit payload enhancement to distinguish settlement failures from pure time-driven errors
- ✅ SYSTEM actor audit implementation with canonical UUID (`00000000-0000-0000-0000-000000000000`)
- ✅ Audit records use FK-safe, non-null `admin_user_id` for SYSTEM actions
- ✅ Read-only settlement readiness checks (no persistence, no side effects)
- ✅ Idempotent error recovery (repeated checks do not create duplicate audits)

**Not yet implemented (deferred to GAP-09):**
- ❌ Settlement logic: `isReadyForSettlement()` still throws "Not implemented: isReadyForSettlement"
- ❌ Settlement computation: `computeRankings()`, `allocatePayouts()`, prize distribution
- ❌ Settlement record persistence: `settlement_records` table and schema
- ❌ Writing `settle_time` timestamp (currently null until settlement execution in GAP-09)
- ❌ Settlement result immutability and audit trails for settlement outcomes
- ❌ Admin settlement resolution paths (ERROR → COMPLETE with settlement retry)

### Audit Trail Examples

**Settlement-triggered ERROR (LIVE→COMPLETE failure):**
```json
{
  "contest_id": "<contest-uuid>",
  "admin_user_id": "00000000-0000-0000-0000-000000000000",
  "action": "system_error_transition",
  "reason": "Automatic transition to ERROR due to failed attempt to transition to COMPLETE",
  "payload": {
    "attempted_status": "COMPLETE",
    "error_name": "Error",
    "error_message": "Not implemented: isReadyForSettlement",
    "settlement_failure": true,
    "error_origin": "settlement_readiness_check",
    "error_stack": "Error: Not implemented: isReadyForSettlement\n    at isReadyForSettlement (settlementStrategy.js:XX)\n    at isContestGamesComplete (contestLifecycleAdvancer.js:87)"
  }
}
```

**Key audit fields for settlement failures:**
- `admin_user_id: "00000000-0000-0000-0000-000000000000"` — Canonical SYSTEM user UUID for automated actions
- `settlement_failure: true` — Distinguishes this from other error types
- `error_origin: "settlement_readiness_check"` — Specifies the exact failure origin
- `error_stack` — Full stack trace (truncated to 1000 chars) for debugging settlement logic
- `attempted_status: "COMPLETE"` — The state that was being transitioned to

**Pure time-driven ERROR (for comparison—SCHEDULED→LOCKED failure):**
```json
{
  "contest_id": "<contest-uuid>",
  "admin_user_id": "00000000-0000-0000-0000-000000000000",
  "action": "system_error_transition",
  "reason": "Automatic transition to ERROR due to failed attempt to transition to LOCKED",
  "payload": {
    "attempted_status": "LOCKED",
    "error_name": "DatabaseError",
    "error_message": "Connection timeout"
  }
}
```

**Note:** Time-driven errors (non-settlement) do NOT include `settlement_failure`, `error_origin`, or `error_stack` fields. These are only present for settlement-related failures. This allows queries like `WHERE payload->>'settlement_failure' = 'true'` to isolate settlement errors programmatically.

### Testing

Settlement integration is tested via:
- **Unit tests:** `isContestGamesComplete()` with mocked settlement readiness
- **Integration tests:** Full LIVE→ERROR transition with audit verification
- **Audit queries:** `WHERE action = 'system_error_transition' AND payload->>'settlement_failure' = 'true'`

### Admin Resolution

Contests in ERROR due to settlement failure can be resolved via admin API:
- ERROR → COMPLETE (if settlement is now ready)
- ERROR → CANCELLED (if contest cannot be settled)

---

## Claude Execution Constraints

When any Claude session works on code related to contests, the following constraints are mandatory.

1. **SOLID principles are mandatory.** Contest logic must follow Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion principles in both design and implementation.
2. **No blind schema assumptions.** Claude must read and verify the actual database schema before writing any query or migration. Column names, table names, and relationships must be confirmed from the codebase, not assumed from this document or any other reference.
3. **A safe schema map must be produced before code changes.** Before modifying contest-related code, Claude must output a schema map based on the actual schema it has read, and confirm it matches the conceptual model in this document.
4. **Unit tests must be run using DATABASE_URL if present, otherwise a dummy string.** The test command must use the environment variable `DATABASE_URL` when available. If it is not set, use a placeholder connection string. Tests must not be skipped due to missing configuration.
5. **Claude must stop and wait for test results before proceeding.** After running tests, Claude must not continue with further code changes until test output has been reviewed and all failures are addressed.
6. **Claude must add or update a folder-local README.md when code is later changed.** Any directory containing contest-related code that is modified must have a README.md explaining the purpose and contents of that directory. If one exists, it must be updated to reflect changes. If one does not exist, it must be created.

---

## GAP-09 Settlement Execution

### Implementation Complete

GAP-09 (Settlement Logic Implementation) is now complete. It builds on GAP-08's error handling infrastructure and implements the full settlement computation and persistence layer.

### What GAP-09 Implements

**Settlement Readiness Validation**
- `isReadyForSettlement(pool, contestInstanceId)` — Verifies all contest participants have final scores for all 4 playoff weeks
- Single SQL query with `COUNT(DISTINCT week_number)` to detect missing scores
- Throws error with detailed participant information if any scores are missing

**Ranking and Payout Computation (Pure Functions)**
- `computeRankings(scores)` — Competition ranking (1, 1, 3 for ties, not dense)
- `allocatePayouts(rankings, payoutStructure, totalPoolCents)` — Percentage-based payout allocation with tie splitting
- `calculateTotalPool(contestInstance, participantCount)` — Calculates total prize pool from entry fees

**Deterministic Hashing**
- `canonicalizeJson(obj)` — Deep recursive key sorting for deterministic SHA-256 hashing
- Ensures settlement results are reproducible and verifiable

**Settlement Execution**
- `executeSettlement(contestInstance, pool)` — Full transactional settlement with:
  - Row-level lock (`SELECT FOR UPDATE`) to prevent concurrent attempts
  - Idempotency check: returns existing settlement if already executed
  - Consistency validation: detects orphaned `settle_time` without records
  - Score fetching and ranking computation
  - Atomic insert into `settlement_records` table
  - Single write to `contest_instances.settle_time`
  - SYSTEM audit record with result hash and metadata

**Lifecycle Integration**
- Settlement executes BEFORE status update for LIVE→COMPLETE transitions
- If settlement throws, error recovery catches it and transitions contest to ERROR
- Status only changes to COMPLETE after successful settlement

### Invariants Guaranteed

1. **No silent settlement failures:** Settlement errors move contests to ERROR (via GAP-08 recovery)
2. **Immutable results:** `settlement_records` is the single source of truth, with SHA-256 hashing for verification
3. **Deterministic:** Same contest data always produces same rankings and payouts
4. **Idempotent:** Repeated settlement calls return existing record, no duplicates
5. **Isolated:** Row-level locks prevent concurrent settlement attempts
6. **Atomic:** All writes succeed or all rollback, no partial settlement

### Testing

28 comprehensive tests covering:
- Unit tests for ranking, payout, and hashing functions
- Integration tests for settlement execution
- Idempotency verification
- Concurrent attempt handling
- Tie scenario correctness
- Error and edge case handling
- Audit trail verification

All tests pass successfully.

### Assumptions GAP-09 Can Make

- Settlement errors during LIVE→COMPLETE will automatically move contests to ERROR (GAP-08's error recovery handles this)
- Audit records distinguish settlement errors from other errors (via payload markers: `settlement_failure: true`, `error_origin: 'settlement_readiness_check'`)
- `isContestGamesComplete()` will always call `isReadyForSettlement()` when `end_time` has passed
- Settlement logic can throw errors without fear of silent failures—the error recovery boundary catches all throws
- Settlement readiness checks are read-only and have no side effects (no data persistence, no timestamp writes)
- Settlement validation occurs inside the error recovery boundary in `attemptSystemTransitionWithErrorRecovery()`
- SYSTEM audit records use the canonical UUID `00000000-0000-0000-0000-000000000000` for `admin_user_id`
- Settlement is only checked for LIVE contests past `end_time` (time gate is checked first)
- Re-running settlement checks on the same contest multiple times will create separate audit records for each failure (no deduplication)
- If settlement is never ready, contests will remain in LIVE state indefinitely until admin intervention

### What GAP-09 Must NOT Assume

- `isReadyForSettlement()` has been implemented (it still throws "Not implemented" in GAP-08)
- Settlement computation functions exist (`computeRankings()`, `allocatePayouts()`, etc. — these are GAP-09 work)
- `settlement_records` table exists (must be created in GAP-09)
- `settle_time` is being written (GAP-08 only validates readiness, does not persist results)
- Admin settlement endpoint exists (no new affordances in GAP-08)
- Manual settlement trigger/retry endpoint exists (settlement is automatic via read-path self-healing)
- Partial settlement is supported (v1 contract excludes this)
- Retroactive score corrections are possible (v1 contract excludes this)
- Dispute resolution mechanisms exist (v1 contract excludes this)
- ERROR contests can be automatically resolved to COMPLETE on retry (admin must manually resolve)
- Settlement can be triggered independently of read-path self-healing (all settlement checks occur in LIVE→COMPLETE evaluation)

---

## Stripe Webhook Processing Guarantees (Phase 03)

Stripe webhook processing is built on append-only, idempotent foundations with strict transactional boundaries.

### Append-Only Architecture

The `stripe_events` table is append-only at both application and database layers:
- **Database enforcement:** PostgreSQL trigger `stripe_events_no_update` prevents all UPDATE and DELETE operations
- **Schema:** `UNIQUE` constraint on `stripe_event_id` ensures each Stripe event ID can be inserted at most once
- **Consequence:** Duplicate webhook deliveries are detected via the unique constraint, not via mutable state

### Idempotency Guarantees

**Layer 1: Stripe Event Deduplication**
- Primary key: `stripe_events.stripe_event_id` (Stripe's evt_* ID, uniquely indexed)
- Duplicate stripe_event_id → PG error 23505 (unique violation)
- Duplicate is rolled back, not silently ignored
- Caller receives `{ status: 'duplicate', stripe_event_id: evt_* }` — idempotent success

**Layer 2: Ledger Entry Deduplication**
- Ledger entries for payment_intent.succeeded use idempotency key: `stripe_event:{event_id}:ENTRY_FEE`
- Primary key: `ledger.idempotency_key` (partially unique, WHERE NOT NULL)
- Duplicate key → PG error 23505 (unique violation)
- Duplicate is rolled back, not inserted twice
- Service catches 23505 and returns idempotent success (no ledger mutation)

### Transactional Atomicity

**Transaction Boundaries**
```
BEGIN TRANSACTION
  ↓
INSERT stripe_events (with Stripe's event ID)
  ↓
If duplicate stripe_event_id → ROLLBACK (no poisoned dedupe rows)
  ↓
For payment_intent.succeeded:
  - Fetch payment_intent from payment_intents table
  - Validate payment_intent exists (throw 409 if not found)
  - If already SUCCEEDED, skip remaining steps (idempotent)
  - UPDATE payment_intents.status = 'SUCCEEDED'
  - INSERT ledger entry (with idempotency_key)
  ↓
COMMIT (all or nothing)
  ↓
On any error → ROLLBACK (prevents partial state, Stripe retries)
```

**Critical Invariants**
1. `stripe_events` insert is INSIDE the transaction (not outside)
2. If processing fails, stripe_events insert is rolled back (no poisoned rows)
3. Stripe will retry the webhook after ROLLBACK, allowing success on retry
4. Ledger entries only created after payment intent validation succeeds
5. All writes are atomic: succeed together or fail together

### Processing Semantics

- **payment_intent.succeeded:** Only canonical event type with side effects (ledger insertion)
- **Other event types:** Stored in stripe_events but not processed (future extensibility)
- **Processing status:** Immutable after receipt (`processing_status = 'RECEIVED'`; no mutations)

### Observability

Audit trail captures:
- Stripe event ID (evt_*)
- Internal payment intent ID (UUID, used as reference_id in ledger)
- Ledger entry creation timestamp
- Idempotency key (stripe_event:{event_id}:ENTRY_FEE)

Queries to reconstruct payment flows:
```sql
SELECT * FROM ledger
WHERE stripe_event_id = 'evt_...'
ORDER BY created_at;

SELECT * FROM stripe_events
WHERE stripe_event_id = 'evt_...'
ORDER BY received_at;
```

---

## Change Log

| Date | Version | Author | Description |
|---|---|---|---|
| 2026-02-15 | v1 | System | **PHASE 03 COMPLETE: Stripe Webhook Finalization & Cleanup**. Removed all debug logs from webhook/payment paths. Confirmed stripe_events append-only via database trigger. Verified transaction boundaries (BEGIN → insert stripe_event → process → COMMIT with ROLLBACK on failure). Idempotency enforced at two layers: stripe_event_id (unique at DB) and ledger.idempotency_key (unique at DB). Added "Stripe Webhook Processing Guarantees" section to contest-lifecycle.md documenting architecture, idempotency, transactional boundaries, and audit trail. Updated contest-infrastructure-v1-gaps.md change log. Unit tests passing; staging E2E confirmed. |
| 2026-02-11 | v1 | System | GAP-14 LIGHTENED: Replaced domain event abstraction with lightweight transition_origin classification in audit payload (TIME_DRIVEN, ADMIN_MANUAL, SETTLEMENT_DRIVEN, ERROR_RECOVERY). No new tables. Enables deterministic observability for debugging and compliance. Added "Transition Origin Classification" section with usage examples. Completion criteria: 10 integration tests, documentation updated. Proportional risk: minimal architectural impact. |
| 2026-02-11 | v1 | System | GAP-13 COMPLETED: Five service-layer admin operations now enforce the contract's valid transition graph and time field invariants with the same rigor as automated processes. (1) cancelContestInstance: SCHEDULED/LOCKED/LIVE/ERROR → CANCELLED; COMPLETE is terminal. (2) forceLockContestInstance: SCHEDULED → LOCKED via SYSTEM actor (ADMIN updates lock_time). (3) updateContestTimeFields: SCHEDULED-only time updates with invariant validation. (4) triggerSettlement: LIVE → COMPLETE (if settlement ready) or LIVE → ERROR (if not ready). (5) resolveError: ERROR → COMPLETE (with settlement execution) or ERROR → CANCELLED. All operations use row-level locking (SELECT FOR UPDATE), explicit state checks after lock, audit trail discipline (success/idempotency/rejection), transition validation via assertAllowedDbStatusTransition(), and support idempotency. Settlement execution respects transaction boundaries (outside active transactions for executeSettlement()). Audit schema corrected: contest_instance_id, admin_user_id, action, reason, from_status, to_status, payload. Updated "Admin Operations Contract" section with implementation details and shared patterns. |
| 2026-02-11 | v1 | System | GAP-12 CLOSED: "Contest List (My Contests)" section now fully implemented. Endpoint GET /api/contests/my returns contests user entered or SCHEDULED contests open for entry. Six-tier sorting enforced at SQL layer with CASE tier assignment and tier-scoped time columns. ERROR contests hidden from non-admin users (fail-closed policy). Metadata-only list response (no standings, deterministic and scalable). Dedicated `mapContestToApiResponseForList` mapper enforces list-specific invariants, separating read model concerns from detail endpoints. Non-mutating list endpoint (no self-healing). Pagination deterministic: limit [1,200] default 50, offset >= 0 default 0. Updated "Contest List (My Contests)" section with implementation notes documenting endpoint, SQL sorting strategy, error visibility, read model separation, pagination, non-mutating behavior, and authentication requirements. |
| 2026-02-10 | v1 | System | GAP-08 complete and documented: (1) Settlement validation location clarified—occurs inside `attemptSystemTransitionWithErrorRecovery()` error recovery boundary, not only in `advanceContestLifecycleIfNeeded()`. (2) SYSTEM audit implementation documented with canonical UUID `00000000-0000-0000-0000-000000000000`. (3) Audit payload contracts defined for settlement failures: `settlement_failure: true`, `error_origin: 'settlement_readiness_check'`, full error stack. (4) Error recovery semantics guaranteed: failed settlement checks trigger LIVE→ERROR with distinguishable audit records. Settlement logic implementation remains deferred to GAP-09. |
| 2026-02-08 | v1 | System | Initial creation of the Contest Lifecycle Contract. All sections defined. This is the authoritative v1 baseline. |
