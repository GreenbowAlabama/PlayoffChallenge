# Infrastructure Hardening Program

## Objective

Achieve **30-Day Survivability** for live contests without manual founder intervention.

This means the system must operate autonomously for 30 consecutive days with:
- No manual database edits
- No manual state repairs
- No founder debugging or intervention
- Deterministic, replay-safe scoring
- Graceful handling of all failure modes
- Complete audit trail and observability

---

## Scope

### In Scope
- Golf tournament engine (Masters-based config model)
- Ingestion stability and validation
- Deterministic payment collection and ledger tracking
- Deterministic validation and scoring
- Operational runbooks and failure recovery
- Contest lifecycle automation (SCHEDULED → LOCKED → LIVE → COMPLETE → CANCELLED → ERROR)
- Replay-safe settlement logic
- Schema versioning and snapshot management
- Payment webhook validation and idempotent processing

### Not in Scope
- Multi-sport abstraction layers
- Provider abstraction layer (provider-agnostic ingestion)
- Platform expansion beyond configured tournaments
- Speculative architecture for future use cases
- Feature bloat or over-engineering

---

## Non-Goals

These are explicitly **forbidden** within this program:

- **No multi-sport abstraction**: Each sport (golf, football, etc.) ships as a dedicated engine, not a unified platform
- **No provider abstraction layer**: Ingestion adapts to provider APIs directly; no generic adapter pattern
- **No platform expansion**: Do not build for "any contest type" when supporting one is the requirement
- **No speculative architecture**: Every design decision must solve an active problem, not prepare for future ones

---

## Engineering Principles (Explicit and Enforced)

### SOLID Principles
All code must enforce these without exception:

1. **Single Responsibility Principle (SRP)**
   - Each service owns exactly one lifecycle domain
   - Single Responsibility boundaries must be documented in service-level CLAUDE.md files
   - No god services; no service should handle multiple independent concerns

2. **Open/Closed Principle**
   - Services extend behavior only through explicit interfaces
   - No implicit hooks, plugins, or callbacks
   - Changes to one service must not require rewrites of others

3. **Liskov Substitution Principle (LSP)**
   - Concrete implementations must honor their declared contracts
   - No "almost compatible" implementations
   - Type contracts must be validated at runtime

4. **Interface Segregation Principle (ISP)**
   - Only expose methods that callers actually need
   - No fat interfaces that include unused methods
   - Caller requirements drive interface shape

5. **Dependency Inversion Principle (DIP)**
   - High-level modules depend on abstractions, not concrete implementations
   - Dependency direction is explicit and acyclic
   - No circular dependencies; no "magic wiring"

### Explicit Constraints
- **No implicit behavior**: Every behavior must be discoverable in documentation or code
- **No silent failures**: Every failure mode must be logged, audited, and recoverable
- **Config-driven tournaments only**: Contest configuration drives behavior; hardcoding tournament rules is forbidden
- **Backend authoritative validation**: Frontend cannot trust user input; backend validates all data
- **Fail loud, never silent**: Graceful degradation must not hide errors; errors must propagate with full context
- **No manual DB edits during live contests**: State repairs must be automated or impossible to need

---

## Definition of 30-Day Survivability

The system is considered **30-day survivable** when ALL of the following are true:

### Autonomy
- ✓ Contest lifecycle transitions happen automatically on data-driven triggers
- ✓ Scoring executes without manual intervention
- ✓ Ingestion validates, replays, and corrects without manual oversight
- ✓ Failures are detected, logged, and recoverable without founder involvement

### Determinism
- ✓ Scoring is reproducible from the same input data
- ✓ Re-running settlement produces identical results
- ✓ One contest's scoring cannot affect another contest's data
- ✓ Historical data is immutable; corrections create new records, not overwrites
- ✓ Contest COMPLETE state must be triggered by explicit provider terminal status or verified final round completion, not by inferred absence of updates

### Observability
- ✓ All state transitions are audited with timestamps, actor, and reason
- ✓ Failure logs contain sufficient context to debug without production access
- ✓ Metrics exist for: ingestion lag, scoring duration, failure rate, settlement correctness
- ✓ Admin dashboard reflects real-time contest state accurately

### Operational
- ✓ Runbooks exist for every known failure mode
- ✓ Operational procedures require no database access knowledge
- ✓ Configuration changes can be deployed without code changes
- ✓ Rollback procedures are tested and documented

### Technical
- ✓ Unit tests cover all service contracts and failure modes
- ✓ No service depends on undocumented behavior from another
- ✓ Schema is versioned, snapshot is current, migrations are reversible
- ✓ No tech debt that blocks autonomy

---

## Iteration Closure Requirements

**Before closing any iteration, the following must be completed:**

1. **Documentation Updated**
   - Iteration .md file updated with final architecture and decisions
   - All sections (Objective, Constraints, SOLID Enforcement, etc.) are accurate
   - Lessons Learned section is complete and candid

2. **Schema Snapshot Updated**
   - Current schema dumped to `/backend/db/schema.snapshot.sql`
   - Header comment reflects iteration and date
   - File is committed to version control

3. **Unit Tests Aligned**
   - All service-level unit tests exist and pass
   - All lifecycle state transition tests are present
   - All ingestion validation tests are comprehensive
   - All failure case tests cover documented failure modes
   - No silent parsing allowed; all invalid input explicitly rejected

4. **Assumptions Purged**
   - No implicit coupling between services remains
   - All interface contracts are explicit
   - SOLID boundaries are enforced and documented
   - Architecture review checklist is complete

5. **Runbooks (Iteration 6+)**
   - Operational procedures are step-by-step and role-based
   - No "ask engineering" steps; runbooks must be executable by ops
   - Failure detection and recovery procedures are tested
   - Payout failure modes documented and tested

6. **Automatic Payout (Iteration 5)**
   - Payout job scheduled automatically on settlement complete
   - All transfers executed via Stripe without manual action
   - Idempotent retry logic prevents duplicate transfers
   - Stripe transfer IDs and ledger entries persisted and auditable

---

## Payment Governance

Payment integration must be deterministic, auditable, and never inject fragility into the contest lifecycle.

### Core Principles
- **Idempotent Payment Collection**: Same inputs always produce same payment state
- **Webhook-Verified**: Stripe webhooks validated with cryptographic signatures before processing
- **No Silent Failures**: All payment events are logged; validation failures are explicit
- **Ledger Immutable**: All financial transactions recorded append-only; no edits or deletions
- **Contest Independence**: Payment state cannot mutate contest lifecycle (SCHEDULED → LOCKED → LIVE → COMPLETE)
- **Automatic Payout Required**: Manual payout workflow completes Iteration 03 (Payment Integration). Automatic payout execution is Iteration 05 (mandatory before 30-Day Survivability). Survivability requires zero operator payout execution.

### Constraints
- Payment logic is isolated in dedicated services (PaymentService, WebhookHandler, LedgerRepository)
- Stripe webhook events are stored raw before processing (audit trail)
- Duplicate webhooks are idempotent (same event produces one ledger entry)
- Payment amount validation prevents silent discrepancies
- All payment and payout records are immutable and auditable
- Future automatic payout must not break manual payout workflows

### Integration Point
- Payment integration is Iteration 03, immediately after Ingestion (Iteration 02) and before Contract Freeze (Iteration 04)
- This ordering ensures: deterministic ingestion → deterministic payments → frozen contracts → operational runbooks
- Runbooks (Iteration 06) include payment and payout failure modes and recovery procedures

---

## Iteration Schedule

- **Iteration 01**: Masters Config-Driven Golf Engine
- **Iteration 02**: Ingestion Validation + Replay + Safeguards
- **Iteration 03**: Payment Integration + Ledger Governance
- **Iteration 04**: Backend Contract Freeze + Canonical Documentation
- **Iteration 05**: Automatic Payout Execution
- **Iteration 06**: Operational + Technical Runbooks + Founder Absence Simulation

Each iteration is a complete, independent closure before the next begins.

### Contract Freeze Dependencies
- Contract Freeze (Iteration 04) cannot begin until:
  - All payment endpoints are defined with explicit schemas
  - Webhook validation procedure is documented
  - Ledger reconciliation interface is specified
  - Error codes are enumerated (PAYMENT_FAILED, DUPLICATE_INTENT, WEBHOOK_INVALID, etc.)
  - Payment state transitions are explicit (no hidden state)

### Automatic Payout Dependencies
- Automatic Payout (Iteration 05) cannot begin until:
  - Contract Freeze (Iteration 04) is complete
  - All payment endpoints are finalized (Iteration 04)
  - Settlement strategy is complete (Iteration 01-02)
  - Payment ledger is auditable and append-only (Iteration 03)

- Runbooks (Iteration 06) cannot close until:
  - Automatic Payout (Iteration 05) is complete and verified operational
  - Payout failure modes are documented and tested
  - Founder Absence Simulation passes: 14-day staging test with zero engineering access

---

## System Invariants (Cannot Be Violated)

These are merge blockers. Any code that violates these invariants must be rejected.

- **Ingestion events are append-only**: No edits or deletes; only new events
- **Ledger entries are append-only**: All financial transactions are immutable; corrections are new entries
- **Contest config immutable in LOCKED/LIVE**: Configuration cannot change once contest is locked
- **Settlement is transactional and all-or-nothing**: Partial scores are forbidden; all-or-nothing only
- **Payment cannot mutate contest lifecycle**: Payment state is independent; payment failures do not lock, cancel, or settle contests
- **Completion requires deterministic terminal signal**: COMPLETE state triggered only by explicit provider signal or verified final round completion; never by inferred absence
- **No silent errors allowed anywhere in stack**: All validation failures, errors, and anomalies must be logged explicitly with full context
- **Automatic payout required for survivability**: Iteration 05 implements automatic payout execution. Manual payout exists in iteration 03 only for initial implementation. 30-Day Survivability requires automatic payout (Iteration 05) to be complete and verified operational.
- **User participation contingent on payment success**: Unpaid users cannot be active participants; participation requires SUCCEEDED payment status

Violations of these invariants are blocking defects.

---

## Environment Governance

Environment isolation is mandatory. No environment-specific logic in code; all environment differences are configuration-driven.

- **API and Web Admin run from staging branch only**: Production code is never deployed to staging infrastructure or TestFlight builds.
- **iOS production builds point to staging API**: `API_BASE_URL` configuration directs TestFlight builds to staging backend endpoint. Production mobile app uses production API endpoint only.
- **Production API must never be used by TestFlight builds**: Strict environment separation prevents data contamination and revenue misclassification.
- **Production deploy requires explicit manual promotion**: No automatic branch promotion. Staging → Production is an explicit, documented operator action with approval trail.
- **No environment-specific logic in code**: All environment differences are configuration-driven via environment variables. Code is environment-agnostic.
- **Stripe keys and ingestion endpoints must be environment-scoped**: `STRIPE_API_KEY` (staging vs. production), `STRIPE_WEBHOOK_SECRET` (scoped by environment), `INGESTION_ENDPOINT_URL` (provider staging vs. production). Environment variables are the source of truth.
- **Schema snapshot must match deployed staging database**: Before iteration closure, schema snapshot is verified to match current staging schema. Snapshot is committed. Production rollback uses snapshot version from that release.

---

## Infrastructure Tooling Constraints

The following infrastructure tooling decisions are binding and non-negotiable:

- **Stripe for all payment rails**: Stripe must be used for all payment rails (checkout, payment intents, webhooks, transfers, disputes). No custom payment processors or payout rails are permitted. Automatic payout uses `stripe.transfers.create()` with idempotency keys for all payouts.
- **Production-grade job system required**: All asynchronous background processing must use a production-grade job system (e.g., BullMQ or equivalent). Custom retry engines or in-memory queue implementations are prohibited.
- **Formal schema validation mandatory**: All request and response validation must use a formal schema validation library (e.g., Zod, Joi, or equivalent). Manual inline validation logic is not permitted.
- **OpenAPI specification required**: Public API contracts must be generated from a formal OpenAPI specification derived from route schemas. Admin routes must be excluded by default unless explicitly documented.
- **No custom infrastructure implementations**: No custom implementations of solved infrastructure problems are allowed when a stable, production-grade OSS or managed solution exists.
- **Tooling decisions are binding**: Infrastructure tooling decisions are binding and may only be changed through a documented decision log entry.

---

## Governance

This document is law. Deviations require explicit written approval from engineering leadership and must be documented in iteration Lessons Learned with the reason why the constraint was not met.

When iteration documentation contradicts this overview, this overview wins. Update iteration docs to comply.

When code contradicts this documentation, the documentation is correct and code must change.

---

## Contact & Ownership

This program is owned by 67 Enterprises engineering.

Questions about scope, constraints, or iteration closure should be escalated before starting work.
