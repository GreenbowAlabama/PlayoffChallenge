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

### Contest Detail

Returns the full contest object including all derived fields listed above. The response shape is identical regardless of lifecycle state; field presence varies as described in the derived fields section.

### Entry Submission

- Permitted only when the contest is in the SCHEDULED state.
- The backend must verify state at the time of the write, not at the time of the request.
- If the contest has transitioned to LOCKED between request receipt and write, the submission must be rejected.

### Pick Changes

- Permitted only when the contest is in the SCHEDULED state.
- Same write-time verification as entry submission.

---

## Admin Operations Contract

Admin operations are privileged actions that modify contest state or configuration. These operations are available only to authenticated admin users.

| Operation | Permitted States | Effect |
|---|---|---|
| Create contest | N/A | Creates a new contest in SCHEDULED state with all required time fields. |
| Update time fields | SCHEDULED, LOCKED (with restrictions) | Modifies lock_time, start_time, or end_time subject to time field invariants. |
| Cancel contest | SCHEDULED, LOCKED, LIVE | Transitions contest to CANCELLED. |
| Force-lock contest | SCHEDULED | Transitions contest to LOCKED immediately, updating lock_time to now. |
| Trigger settlement | COMPLETE | Executes the settlement process. |
| Resolve error | ERROR | Transitions contest to COMPLETE or CANCELLED after manual investigation. |

Admin operations must enforce the same state transition rules and time field invariants as automated processes. There are no admin overrides that bypass validation in v1.

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
5. The API returns all derived fields as specified, computed by the backend.
6. The "My Contests" sort order matches the defined rules.
7. Admin operations enforce the same validation as automated processes.
8. No client computes, infers, or derives lifecycle state.

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

## Change Log

| Date | Version | Author | Description |
|---|---|---|---|
| 2026-02-08 | v1 | System | Initial creation of the Contest Lifecycle Contract. All sections defined. This is the authoritative v1 baseline. |
