# Architectural Decision Log

**Purpose**: Capture every architectural decision made during the Infrastructure Hardening Program.

**Why This Matters**:
- Prevents architectural drift by documenting *why* decisions were made
- Enables future engineers to understand constraints without asking
- Protects against re-litigating settled decisions
- Provides evidence for design reviews and postmortems

**Governance Rule**: Every architectural decision must be logged before closing an iteration. Decisions without documentation are re-opened.

---

## Decision Log Format

Each decision entry follows this structure:

```
### Decision: [Title]
**Date**: YYYY-MM-DD
**Iteration**: [Number]
**Context**: [What problem prompted this decision?]
**Decision**: [What was decided?]
**Rationale**: [Why this decision? What constraints drove it?]
**Alternatives Rejected**:
  - [Alternative 1]: Why rejected
  - [Alternative 2]: Why rejected
**Impact**: [What changes as a result of this decision?]
**Owner**: [Who made/defended this decision?]
**Status**: Active | Superseded (by: [Decision Title])
```

---

## Active Decisions

### Decision: Config-Driven Golf Engine (No Sport Abstraction)
**Date**: 2026-02-13
**Iteration**: 01 - Masters Engine
**Context**: Need to build a golf tournament engine. Risk: over-engineering a generic sport platform.
**Decision**: Build golf-specific engine. No multi-sport abstraction. When adding another sport, build dedicated engine.
**Rationale**:
- Reduces complexity; solves actual problem (golf) not hypothetical problem (any sport)
- Enables faster iteration on golf rules without coordinating with other sports
- Single Responsibility: golfEngine owns golf logic only
- Avoids premature abstraction; we have 1 sport, not 2
**Alternatives Rejected**:
  - Multi-sport platform abstraction: Increases coupling; adds unnecessary complexity; no second sport in scope
  - Provider-agnostic adapter layer: Increases indirection; reduces clarity; provider APIs are specific
**Impact**:
- golfEngine service is golf-specific (par, strokes, course names acceptable)
- No attempt to generalize scoring rules
- Future sports get dedicated engines
**Owner**: Architecture Team
**Status**: Active

---

### Decision: Append-Only Ingestion Log (No Ingestion Mutation)
**Date**: 2026-02-13
**Iteration**: 02 - Ingestion Safety
**Context**: Need to ensure ingestion is auditable and replayable. Risk: silent corrections or data loss.
**Decision**: Ingestion creates immutable append-only log. Errors are recorded, not overwritten. Corrections are new events.
**Rationale**:
- Enables full replay from checkpoints; no state loss
- Audit trail is complete; all ingestion history is preserved
- Corrections are explicit; no silent overwrites
- Settlement is deterministic; same events always produce same scores
**Alternatives Rejected**:
  - Mutable ingestion cache: No audit trail; enables silent corrections; replay not possible
  - Real-time scoring: Couples ingestion to settlement; if ingestion fails, settlement unclear
**Impact**:
- `ingestion_events` table is append-only
- Corrections are new rows, not edits
- Settlement runs are fully auditable
- Storage grows with ingestion volume; acceptable for 30-day window
**Owner**: Ingestion Team
**Status**: Active

---

### Decision: Contest Config Immutable During LOCKED/LIVE States
**Date**: 2026-02-13
**Iteration**: 01 - Masters Engine
**Context**: Risk: scoring rules changing mid-tournament affects determinism and fairness.
**Decision**: Once contest enters LOCKED state, config is immutable. Changes rejected at application layer.
**Rationale**:
- Scoring rules cannot drift mid-tournament
- Participants see consistent rules
- Settlement is deterministic; same config always produces same results
- Prevents accidental rule changes affecting fairness
**Alternatives Rejected**:
  - Versioned configs with retroactive rule changes: Complexity increases; fairness unclear; settlement can't determine which version applied
  - Allowing config changes with audit only: Rules can still drift; no enforcement
**Impact**:
- Config changes blocked on LOCKED/LIVE contests (with clear error message)
- Config versioning enables pre-LOCKED rule adjustments
- DB constraint enforces this rule
**Owner**: Contest Lifecycle Team
**Status**: Active

---

### Decision: Explicit Error Codes (No Generic Errors)
**Date**: 2026-02-13
**Iteration**: 03 - Contract Freeze
**Context**: Risk: generic error responses hide root causes; frontend can't respond appropriately.
**Decision**: All error codes are enumerated. Surprise errors are bugs. No generic 500s for expected errors.
**Rationale**:
- Frontend can handle specific errors (CONTEST_LOCKED, ALREADY_JOINED) vs. generic ones
- Monitoring can distinguish known errors from anomalies
- Admin can understand what went wrong without reading code
- Tests ensure all documented errors can be triggered
**Alternatives Rejected**:
  - Generic "error occurred": Frontend can't respond; ops can't diagnose
  - Dynamic error codes: No enumeration; contract not verifiable
**Impact**:
- Error registry created and maintained
- All routes return enumerated codes
- Tests validate each code can be triggered
- Contract violations are merge blockers
**Owner**: API Contract Team
**Status**: Active

---

### Decision: Runbooks Executable By Ops (No "Ask Engineering" Steps)
**Date**: 2026-02-13
**Iteration**: 04 - Runbooks
**Context**: Risk: runbooks become advice, not procedures. Ops escalates every incident instead of resolving.
**Decision**: Every runbook step is executable. No interpretation needed. No "ask engineering" steps.
**Rationale**:
- 30-day autonomy requires ops to execute without engineering
- Procedures must be step-by-step with exact commands
- Conditional logic must be explicit (if X, then Y; if not X, then Z)
- Enables 24/7 operations without engineer on-call
**Alternatives Rejected**:
  - Advice-style runbooks: Not executable; requires interpretation; still needs engineering
  - Only documenting happy path: Failure recovery still requires engineering judgment
**Impact**:
- Runbooks are more detailed (exact commands, expected outputs)
- Procedures are longer but clearer
- All failure modes are covered before production
- Runbooks are tested in staging
**Owner**: Operations Team
**Status**: Active

---

### Decision: Settlement is All-Or-Nothing (No Partial Scores)
**Date**: 2026-02-13
**Iteration**: 02 - Ingestion Safety
**Context**: Risk: partial settlement corrupts contest state; some players scored, others not.
**Decision**: Settlement is transactional. If any validation fails, entire settlement rolls back. No partial scores.
**Rationale**:
- Prevents inconsistent contest state (some players scored, others pending)
- One data error doesn't corrupt entire contest
- Retry is safe; replaying identical settlement produces identical results
- Fair to all participants; no partial outcomes
**Alternatives Rejected**:
  - Score individual players independently: Partial failure corrupts contest state; retry unsafe
  - Skip invalid data and continue: Silent corrections; fairness violations
**Impact**:
- Settlement uses database transactions
- All-or-nothing semantics in code
- Validation happens before any scoring
- Failed settlements require full investigation and retry
**Owner**: Settlement Team
**Status**: Active

---

### Decision: No Manual Database Edits During LIVE Contests
**Date**: 2026-02-13
**Iteration**: 01 - Masters Engine
**Context**: Risk: manual edits bypass validation; create audit gaps; enable silent corrections.
**Decision**: System design makes manual edits impossible during LIVE. Corrections are only via documented runbooks.
**Rationale**:
- Preserves audit trail
- No bypassing validation
- All state changes are logged and repeatable
- Prevents founder from "quick fix" that breaks determinism
**Alternatives Rejected**:
  - Allow edits with audit logging: Audit doesn't enforce rules; edits can corrupt settlement
  - Emergency edit procedures: Adds complexity; still manual; still bypass validation
**Impact**:
- DB constraints prevent editing certain tables during LIVE
- Corrections happen only via ingestion → settlement re-run
- Runbooks guide all operational procedures
- No founder-triggered DB edits
**Owner**: Data Integrity Team
**Status**: Active

---

### Decision: Schema Snapshot Updated Each Iteration
**Date**: 2026-02-13
**Iteration**: Multiple
**Context**: Risk: schema drift; code/schema mismatch; rollback not possible.
**Decision**: `/backend/db/schema.snapshot.sql` is updated after every iteration closure and committed.
**Rationale**:
- Canonical schema is always known
- Rollback is possible (schema versioned with code)
- CI/CD can validate schema matches expectations
- Enables schema migration testing
**Alternatives Rejected**:
  - Inferring schema from migrations: Requires running all migrations; error-prone; slow
  - Documenting schema in Markdown: Text format is not runnable; can drift
**Impact**:
- Post-iteration process includes: `pg_dump > schema.snapshot.sql && git commit`
- Snapshot is binary truth for schema
- Rollback procedures reference snapshot
- No manual schema edits; only via migrations
**Owner**: Database Team
**Status**: Active

---

### Decision: Unit Tests Must Match Documentation
**Date**: 2026-02-13
**Iteration**: All
**Context**: Risk: tests and docs diverge; tests pass but behavior is undocumented or different.
**Decision**: If test and documentation disagree, iteration cannot close. Tests and docs must align before closure.
**Rationale**:
- Tests define behavior
- Docs describe behavior
- If they disagree, one is wrong
- Iteration closure forces alignment
**Alternatives Rejected**:
  - Tests OR docs (pick one): Documentation isn't executable; tests without docs are unmaintainable
  - Periodic alignment: Tests and docs drift until next review; code doesn't match either
**Impact**:
- Pre-closure review checks test/doc alignment
- Breaking change in tests = breaking change in docs (or vice versa)
- Prevents silent behavior shifts
- Increases iteration closure time but improves quality
**Owner**: QA Team
**Status**: Active

---

### Decision: Payment Integration as Iteration 03 (Between Ingestion and Contracts)
**Date**: 2026-02-13
**Iteration**: Program Restructuring
**Context**: Payment logic must be hardened and documented before freezing API contracts. Payment depends on deterministic contest lifecycle (iteration 02 ingestion).
**Decision**: Payment Integration becomes Iteration 03, inserted between Ingestion Safety (iteration 02) and Contract Freeze (now iteration 04). Runbooks move to iteration 05.
**Rationale**:
- Payment endpoints must be defined and tested before Contract Freeze
- Payment logic depends on reliable ingestion (iteration 02 complete)
- Payment failure modes must be documented before operational runbooks (iteration 05)
- Ledger schema must be defined before contracts are frozen
- This prevents: incomplete payment endpoints frozen in contracts; payment-dependent contest logic undocumented
**Alternatives Rejected**:
  - Payment after Contract Freeze: Requires reopening frozen contracts; violates immutability principle
  - Payment and Contracts simultaneous: Contracts can't freeze before payment endpoints defined
  - Payment at end (after runbooks): Operational runbooks can't document payment failures without implementation
**Impact**:
- New iteration order: 01 → 02 → 03 (Payment) → 04 (Contracts) → 05 (Runbooks)
- Payment iteration includes: collection, webhooks, ledger, manual payout workflow
- Contract iteration includes payment endpoints defined with explicit schemas
- Runbook iteration covers payment failure modes (webhook, duplicate, refund, chargeback, payout failure)
- All internal references updated (iteration files, templates, decision log, program overview)
**Owner**: Architecture Team
**Status**: Active

---

### Decision: Payment State Independent From Contest Lifecycle
**Date**: 2026-02-13
**Iteration**: 03
**Context**: Risk: Payment failures could cascade to contest state mutations (auto-lock, auto-cancel). This couples payment and contest logic, violating SRP.
**Decision**: Payment state is completely independent from contest lifecycle. Payment failures cannot lock, cancel, or settle contests. Contest state transitions are explicit operator actions only.
**Rationale**:
- Payment and contest are orthogonal concerns; coupling violates Single Responsibility Principle
- Payment failures should not break contest operations
- Contest lifecycle is data-driven (timestamps, ingestion completion); payment is financial only
- Operator must explicitly decide what to do if payment fails (not automatic)
- User eligibility is contingent on successful payment, but contest proceeds regardless
**Alternatives Rejected**:
  - Auto-lock contest if payment fails: Couples payment to contest lifecycle; contests could lock unexpectedly; user experience is broken
  - Auto-refund users with failed payments: Payment failures don't trigger refunds; only explicit operator action initiates refunds
  - Payment-dependent contest transitions: Contest state must remain independent; payment is validation only
**Impact**:
- Payment webhooks never call contest state transition logic
- Payment failures are logged and escalated; operators handle manually
- Contest LOCKED/LIVE state is never affected by payment events
- User participation eligibility checked at score publication time (payment.status = SUCCEEDED required)
- Ledger is separate from contest state
**Owner**: Payment Team, Architecture Team
**Status**: Active (blocking defect if violated)

---

### Decision: Settlement Purity Enforcement

Settlement computation must be pure and side-effect free.

**Date**: 2026-02-13
**Iteration**: 01 - Masters Engine
**Context**: Risk: Settlement logic with side effects is not replayable. If settlement calls Stripe, sends emails, or mutates state, re-running settlement creates duplicates and inconsistencies.
**Decision**: Settlement logic is pure. No Stripe calls, no emails, no state transitions, no external systems. Side effects happen only after settlement commit in orchestration layer.
**Rationale**:
- Replay safety requires identical inputs to produce identical outputs
- Side effects prevent replay (calling Stripe twice charges twice; sending emails twice notifies twice)
- Separation of concerns: settlement = computation; orchestration = side effects
- Enables safe recovery: if settlement fails mid-run, restarting doesn't duplicate side effects
- Determinism is fundamental to 30-day survivability
**Alternatives Rejected**:
  - Settlement with side effects: Re-running settlement creates duplicate charges, emails, state changes
  - Idempotency markers for side effects: Adds complexity; doesn't eliminate root problem (settlement is not pure)
  - Post-settlement cleanup: Doesn't prevent duplicate side effects during settlement
**Impact**:
- Settlement service has no Stripe, email, or state mutation logic
- All external calls are in orchestration layer (after settlement succeeds)
- Unit tests verify settlement functions are pure (no mocks required for external services)
- Settlement can be safely replayed from identical input without duplication
**Owner**: Settlement Team
**Status**: Active (architectural invariant)

---

### Decision: Environment Isolation and Governance

Strict environment separation prevents data contamination and production/staging confusion.

**Date**: 2026-02-13
**Iteration**: Program-Level
**Context**: Risk: TestFlight builds point to production API, staging builds use production data, or environments share Stripe accounts. Data contamination causes revenue loss and debug chaos.
**Decision**: Staging-only API for TestFlight via `API_BASE_URL` config. Production API never used by mobile builds. Stripe keys and ingestion endpoints are environment-scoped. No automatic branch promotion.
**Rationale**:
- Config-driven environment differences (not code logic) reduce complexity and prevent conditionals
- TestFlight users are not production; their data must be isolated
- Production promotion is explicit operator action with approval, not automatic
- Stripe accounts per environment prevent cross-contamination (production charges from staging)
- Schema snapshot matches deployed database enables safe rollback
**Alternatives Rejected**:
  - TestFlight uses production API: User data contamination; testing on live revenue is risky
  - Automatic branch promotion: Removes approval gate; mistakes propagate to production
  - Environment logic in code: Conditional branches per environment; harder to test; easy to misconfigure
**Impact**:
- `API_BASE_URL` (TestFlight) = staging endpoint; `API_BASE_URL` (production) = production endpoint
- `STRIPE_API_KEY_PROD` != `STRIPE_API_KEY_STAGING`
- `INGESTION_ENDPOINT_URL` (staging) vs. (production) configured separately
- Production deploy is manual: staging → production requires explicit approval
- Schema snapshot committed per iteration; rollback uses snapshot from release tag
**Owner**: Infrastructure Team, DevOps
**Status**: Active (governance requirement)

---

### Decision: Idempotency As First-Class Invariant

All mutating operations must be idempotent. Duplicate external events must be safe.

**Date**: 2026-02-13
**Iteration**: 03 - Payment Integration
**Context**: Risk: Retries, network failures, and webhook redelivery create duplicate requests. Without idempotency, duplicates cause duplicate charges, ledger entries, payouts.
**Decision**: All state-mutating endpoints require idempotency keys. All Stripe webhook event IDs are stored before processing. Duplicate requests and events are idempotent (same result, no side-effect multiplication).
**Rationale**:
- Network failures are inevitable; retries are necessary
- Stripe retries webhooks automatically; we must handle duplicates
- Idempotency keys enable safe retries without duplicate state changes
- Event ID deduplication prevents duplicate ledger entries
- Operator retries (accidental clicks) are safe and intuitive
**Alternatives Rejected**:
  - No idempotency: Duplicate requests create duplicate ledger entries, charges, payouts; requires manual cleanup
  - Client-side deduplication only: Server still creates duplicates on network replay
  - Complex deduplication logic: Increases fragility; still doesn't cover all cases
**Impact**:
- Payment intent creation: POST with `idempotencyKey`; same key returns cached intent
- Webhook processing: Store `stripe_event_id` before processing; check for duplicates before applying
- Payout request: Verify payout not already initiated before creating new payout record
- Service-layer responsibility: Services enforce idempotency; controllers call services
- Unit tests verify idempotency: Same request twice produces one result, not two
**Owner**: Payment Team, Architecture Team
**Status**: Active (architectural invariant)

---

### Decision: Automatic Payout Required for Survivability

**Date**: 2026-02-16
**Iteration**: Program Restructuring
**Context**: 30-Day Survivability requires zero manual founder involvement. Payment collection without automatic payout leaves critical infrastructure manual. Runbooks cannot close when payout still requires operator action.
**Decision**: Iteration 05 = Automatic Payout Execution. Runbooks (Founder Absence Simulation) move to Iteration 06. Automatic payout is mandatory before 30-Day Survivability is declared.
**Rationale**:
- Payment collection is infrastructure (Iteration 03 complete)
- Payout dispersal is infrastructure (Iteration 05 required)
- Runbooks test autonomy (Iteration 06)
- Contest lifecycle is meaningless without automatic payout
- Founder absence cannot be simulated if manual payout is required
- This separates implementation (05) from testing (06) cleanly

**Alternatives Rejected**:
  - Payout after runbooks: Runbooks can't test what doesn't exist; payout must come first
  - Runbooks including payout implementation: Runbooks document procedures; payout is infrastructure code
  - Manual payout acceptable for survivability: Manual payout requires operator = not autonomous

**Impact**:
- New iteration order: 01 → 02 → 03 → 04 → 05 (Payout) → 06 (Runbooks)
- Iteration 05 includes: PayoutOrchestrationService, PayoutExecutionService, PayoutJobService, StripePayoutAdapter
- Iteration 05 includes: payout_transfers and payout_jobs tables, idempotency key logic, ledger integration
- Iteration 06 runbooks now test payout failure recovery
- Iteration 06 Founder Absence Simulation includes 14-day end-to-end test with automatic payout
- 30-Day Survivability gate: automatic payout must be operational before claim is valid

**Owner**: Architecture Team
**Status**: Active (blocking defect if violated)

---

### Decision: Deterministic Idempotency Key Generation for Payout Transfers

**Date**: 2026-02-16
**Iteration**: 05 - Automatic Payout Execution
**Context**: Payout transfers must be idempotent to prevent duplicate payouts on retry. Idempotency keys must be deterministic so that replaying the same settlement produces identical Stripe transfer IDs. Random key generation defeats determinism and creates retry fragility.
**Decision**: Idempotency keys for payout transfers are derived deterministically from stable composites (e.g., `payout_transfer_id`). Keys are NOT randomly generated. Same transfer always uses the same idempotency key across retry attempts.
**Rationale**:
- Deterministic keys enable replay safety: same settlement always produces same Stripe transfers
- Random keys create unpredictability: re-running payout produces different transfer IDs; can't verify idempotency
- Stripe idempotency works correctly only with stable keys: same key always returns same transfer_id
- Retry safety requires key stability: on timeout, retry uses same key; Stripe returns cached transfer
- Enables operational determinism: auditors can verify payout amounts without uncertainty
**Alternatives Rejected**:
  - Random UUID per attempt: Non-deterministic; breaks replay safety; can't verify idempotency
  - Client-provided keys: Adds complexity; clients may not provide; still need stable fallback
  - Per-settlement global counter: Over-engineered; doesn't provide clear mapping to individual transfers
**Impact**:
- `payout_transfers.idempotency_key` is derived deterministically from `payout_transfer_id`
- Service layer generates key at transfer creation, stored in `payout_transfers.idempotency_key` (UNIQUE constraint)
- All retry attempts use the same key (no new key generation on retry)
- Stripe deduplication ensures only one transfer per idempotency key
- Unit tests verify: same transfer → same idempotency key → same Stripe transfer ID
- Ledger entries reference `idempotency_key` for audit trail traceability
**Owner**: Payout Team, Architecture Team
**Status**: Active (architectural invariant for payout transfers)

---

## Superseded Decisions

(None yet. First decisions logged at program start.)

---

## How to Update This Log

**Before closing an iteration:**
1. Review all architectural decisions made during the iteration
2. Add entries for new decisions (use template above)
3. Update status of any decisions affected by new iterations
4. Include decision log update in closure commit
5. Link from iteration .md file to relevant decision entries

**When opening a new iteration:**
1. Review active decisions that constrain the iteration
2. Note any decisions that enable or conflict with planned work
3. If a decision must be superseded, document why and what replaces it

**Quarterly review:**
1. Re-read decisions for clarity and accuracy
2. Update status if decisions become obsolete
3. Ensure new team members understand decision rationale

---

## Decision Metrics

Track these to ensure governance is working:

- **Decisions logged per iteration**: Should be 5-10 per iteration
- **Decisions re-litigated**: Should be zero (good governance = decisions stick)
- **Decisions superseded**: Should be rare (means we didn't think hard enough initially)
- **Decision clarity**: Team should be able to cite reason for any major architecture choice

---

## Contact & Ownership

This log is owned by the engineering leadership team.

Questions about decision rationale should be directed to the decision owner.

Proposals to supersede decisions require explicit written justification.
