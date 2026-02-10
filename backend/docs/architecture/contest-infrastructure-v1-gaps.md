# Contest Infrastructure v1 Gap Checklist

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
| Status | `EXISTS and conforms` |
| Layer | Backend domain logic |
| Description | Time-driven state transitions are now implemented via read-path self-healing. When a contest is fetched via single-instance read paths (`getContestInstance`, `getContestInstanceByToken`, `resolveJoinToken`), the system evaluates whether a time-based transition is due (e.g., current time ≥ lock_time) and persists the new status atomically using SYSTEM actor authority. This design avoids stale state without requiring background jobs, cron workers, or event loops. Transitions are idempotent and handle race conditions gracefully via conditional UPDATE. Write paths (joins, admin updates) rely on independent guards and do not self-heal; list endpoints are non-mutating. |
| Why it matters | The platform rule "No manual admin steps" (CLAUDE.md) and the contract both require that lifecycle transitions are data-driven and automated. Read-path self-healing ensures contests never surface stale state to single-instance lookups without increasing write fan-out or infrastructure complexity. |
| Dependencies | GAP-01 (correct states), GAP-02 (`end_time` exists), GAP-04 (time invariants enforced), GAP-05 (transition enforcement). |

---

### GAP-07: ERROR state and error recovery path do not exist

| Attribute | Value |
|---|---|
| Status | `MISSING and required for v1` |
| Layer | Backend domain logic |
| Description | The contract defines ERROR as a state that a contest enters when a transition or settlement operation fails. ERROR is not in the database enum. No code transitions a contest to ERROR on failure. No admin resolution path (ERROR-to-COMPLETE or ERROR-to-CANCELLED) exists. |
| Why it matters | The contract's principle "No silent failures" requires that failed transitions surface visibly. Without ERROR, failures are either swallowed or leave contests in inconsistent intermediate states. Admin resolution is impossible if the state does not exist. |
| Dependencies | GAP-01 (state enum must include ERROR), GAP-05 (transition map must include ERROR paths). |

---

### GAP-08: Settlement logic is not implemented

| Attribute | Value |
|---|---|
| Status | `MISSING and required for v1` |
| Layer | Backend domain logic |
| Description | `settlementStrategy.js` exists but every function throws "Not implemented": `computeRankings()`, `allocatePayouts()`, `computeSettlement()`, `calculateTotalPool()`, `isReadyForSettlement()`. The contract requires: settlement executes only in COMPLETE state, is idempotent, verifies all games have final scores, writes `settle_time` exactly once, and produces immutable results. None of this is implemented. |
| Why it matters | Settlement is the terminal operation in the contest lifecycle. Without it, no contest can reach a fully resolved state. The contract's exit criteria require settlement to be "an explicit, idempotent operation that writes settle_time exactly once." |
| Dependencies | GAP-01 (COMPLETE state must exist), GAP-02 (`end_time` for transition eligibility), GAP-05 (transition to COMPLETE must be valid). |

---

### GAP-09: Settlement record entity does not exist

| Attribute | Value |
|---|---|
| Status | `MISSING and required for v1` |
| Layer | Database |
| Description | The contract's Safe Schema Map defines a Settlement Record Entity with identifier, contest reference, timestamp, and per-entry results. No corresponding table or storage exists in the schema. |
| Why it matters | Settlement results must be persisted and immutable. Without a settlement record, there is no way to audit what settlement produced, no way to enforce immutability, and no idempotency anchor. |
| Dependencies | GAP-08 (settlement logic must exist to produce records). |

---

### GAP-10: Write-time state verification is incomplete for picks

| Attribute | Value |
|---|---|
| Status | `EXISTS but violates contract` |
| Layer | Backend domain logic |
| Description | The `joinContest()` path correctly uses `SELECT FOR UPDATE` and verifies status at write time. However, pick submission and pick change paths do not demonstrate equivalent write-time state verification. The contract requires: "The backend must verify state at the time of the write, not at the time of the request" for both entry submission and pick changes. |
| Why it matters | Without write-time verification on picks, a race condition exists where picks could be accepted after a contest has transitioned to LOCKED. The contract explicitly calls out this scenario. |
| Dependencies | GAP-01 (state model must be correct), GAP-05 (transition enforcement must be in place). |

---

### GAP-11: Derived fields are not computed or returned by the API

| Attribute | Value |
|---|---|
| Status | `MISSING and required for v1` |
| Layer | API contract |
| Description | The contract specifies eight derived fields: `status`, `is_locked`, `is_live`, `is_settled`, `entry_count`, `user_has_entered`, `time_until_lock`, `standings`. Currently: `status` is returned but uses non-contract values. A `computedJoinState` helper exists but computes a different set of values (JOINABLE, LOCKED, COMPLETED, UNAVAILABLE) not aligned to the contract. `entries_current` exists but is not named `entry_count`. The remaining fields (`is_locked`, `is_live`, `is_settled`, `user_has_entered`, `time_until_lock`, `standings`) are not computed or returned. |
| Why it matters | The contract principle "Backend is the source of truth" requires that clients receive all lifecycle information from the API. Without these fields, clients must compute state locally, which the contract explicitly forbids. |
| Dependencies | GAP-01 (status values must be correct), GAP-02 (`end_time` needed for some computations), GAP-08 (standings require scoring). |

---

### GAP-12: My Contests sorting does not conform to contract

| Attribute | Value |
|---|---|
| Status | `EXISTS but violates contract` |
| Layer | API contract |
| Description | The current My Contests query sorts by `created_at DESC`. The contract defines a six-tier sort: LIVE by `end_time` asc, LOCKED by `start_time` asc, SCHEDULED by `lock_time` asc, COMPLETE by `settle_time` desc, CANCELLED by `created_at` desc, ERROR hidden from non-admins. |
| Why it matters | Sort order determines what users see first. The contract prioritizes actionable contests (LIVE, then LOCKED, then SCHEDULED) over historical ones. The current sort mixes all states together. |
| Dependencies | GAP-01 (correct states for sort tiers), GAP-02 (`end_time` for LIVE tier sorting), GAP-11 (derived fields support the same API layer). |

---

### GAP-13: Admin operations are incomplete

| Attribute | Value |
|---|---|
| Status | `EXISTS but violates contract` |
| Layer | Admin operations |
| Description | The contract defines six admin operations. Current state: (1) Create contest: exists for organizers, no admin-specific path. (2) Update time fields: only `lock_time` can be updated; `start_time` and `end_time` updates are not supported. (3) Cancel contest: exists but uses non-contract states. (4) Force-lock: does not exist as a discrete operation. (5) Trigger settlement: no endpoint. (6) Resolve error: no endpoint and no ERROR state. Additionally, the admin transition map allows `open -> draft`, which is not a valid contract transition. |
| Why it matters | The contract states "Admin operations must enforce the same state transition rules and time field invariants as automated processes." Incomplete admin operations mean the system cannot be operated within contract bounds. |
| Dependencies | GAP-01 (state enum), GAP-02 (`end_time` for update operations), GAP-05 (transition enforcement), GAP-07 (ERROR state for resolve operation), GAP-08 (settlement for trigger operation). |

---

### GAP-14: Audit trail does not cover automated transitions

| Attribute | Value |
|---|---|
| Status | `EXISTS but violates contract` |
| Layer | Backend domain logic |
| Description | An `admin_contest_audit` table is referenced in code and audit records are written for admin status overrides, lock time updates, and deletions. However: (1) The audit table definition is not present in `schema.sql`. (2) No audit trail exists for automated state transitions. (3) The contract requires "Every state change must be traceable. The backend must record when and why a transition occurred." Admin-only audit does not satisfy this. |
| Why it matters | The contract principle "Auditability" requires that all transitions, not just admin-initiated ones, are recorded. Without comprehensive audit, debugging lifecycle issues and verifying contract conformance are impossible. |
| Dependencies | GAP-06 (automated transitions must exist to be auditable). |

---

### GAP-15: `admin_contest_audit` table is not defined in schema

| Attribute | Value |
|---|---|
| Status | `EXISTS but violates contract` |
| Layer | Database |
| Description | The `adminContestService.js` writes to an `admin_contest_audit` table, but this table is not defined in `schema.sql`. The table may exist in the live database via a migration not captured in the base schema, but its absence from the schema definition means its structure is not contractually verifiable. |
| Why it matters | The contract requires auditability. An audit table that is not defined in the canonical schema cannot be relied upon for structural guarantees (column types, constraints, indexes). |
| Dependencies | None. |

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

---

## v1 Completion Criteria

Contest Infrastructure v1 can be declared complete when every item below is true. Each criterion traces directly to the Contest Lifecycle Contract v1 exit criteria.

- [ ] The `contest_instances` status column supports exactly six values: SCHEDULED, LOCKED, LIVE, COMPLETE, CANCELLED, ERROR. (GAP-01)
- [ ] All five time fields exist on every contest record: `created_at`, `lock_time`, `start_time`, `end_time`, `settle_time`. (GAP-02, GAP-03)
- [ ] Time field invariants (`created_at < lock_time <= start_time < end_time`; `end_time <= settle_time` when present) are enforced on every write. (GAP-04)
- [ ] A single-responsibility state transition module enforces the contract's valid transition graph and rejects all others. (GAP-05)
- [x] Automated processes transition contests through SCHEDULED, LOCKED, LIVE, and COMPLETE based on time fields and game completion. (GAP-06)
- [ ] Failed transitions or settlement operations move contests to ERROR. Admin resolution paths from ERROR to COMPLETE or CANCELLED exist. (GAP-07)
- [ ] Settlement is an explicit, idempotent operation that verifies all games have final scores, writes `settle_time` exactly once, and produces immutable results. (GAP-08)
- [ ] A settlement record entity persists the output of each settlement operation. (GAP-09)
- [ ] Entry submission and pick changes verify contest state at write time using row-level locking. (GAP-10)
- [ ] The API returns all eight derived fields (`status`, `is_locked`, `is_live`, `is_settled`, `entry_count`, `user_has_entered`, `time_until_lock`, `standings`) computed by the backend. (GAP-11)
- [ ] My Contests sorting follows the six-tier contract sort order. ERROR contests are hidden from non-admin users. (GAP-12)
- [ ] All six admin operations (create, update time fields, cancel, force-lock, trigger settlement, resolve error) exist and enforce the same validation as automated processes. (GAP-13)
- [ ] Every state transition (automated and manual) is recorded in an audit trail with timestamp and reason. (GAP-14, GAP-15)

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

### 2. Manual Settlement Triggering

- The act of triggering settlement for a `COMPLETE` contest (per GAP-08) is still a manual admin operation.

### 3. Error State Handling

- The Contest Lifecycle Contract v1 defines an `ERROR` state and admin-only resolution paths (GAP-07 remains incomplete).
- At present, no production code path transitions contests into or out of `ERROR`.
- As a result, no automated or manual error recovery workflow exists in the system today.

### 4. Admin Operations Beyond Time-Driven Transitions

- Time-driven transitions (SCHEDULED → LOCKED → LIVE) are now automated on read paths.
- Other significant state changes (cancellation, force-locking, error resolution) require explicit admin API calls. While these calls now route through the robust `contestTransitionValidator.js`, the _initiation_ of these changes is entirely manual.
- **Caveat:** Admin operations are allowed to trigger state transitions that read-path self-healing is not (e.g., LOCKED → CANCELLED, LIVE → ERROR).

---

## Change Log

| Date | Version | Author | Description |
|---|---|---|---|
| 2026-02-08 | v1 | System | Initial creation of the Contest Infrastructure v1 Gap Checklist. Fifteen gaps identified across database, backend domain logic, API contract, and admin operations layers. All gaps measured against Contest Lifecycle Contract v1. |