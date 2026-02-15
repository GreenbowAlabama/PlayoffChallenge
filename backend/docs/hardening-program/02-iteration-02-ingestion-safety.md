# Iteration 02 – Ingestion Validation + Replay + Safeguards

## Objective

Establish deterministic, replayed, and auditable ingestion from external sports data providers.

The ingestion system must:
- Accept raw provider data without mutations
- Validate before applying to any contest
- Support full replay from historical snapshots
- Detect anomalies without silencing them
- Enable correction and re-settlement without data loss
- Produce deterministic scores from identical input data

---

## Architectural Constraints

### No Provider Abstraction
- This iteration handles one provider's format (e.g., PGA Tour data provider)
- Do not build "pluggable" provider adapters
- When adding a second provider, build a dedicated ingestion path; do not refactor this one
- Provider API structure is explicit in code; provider-specific parsing is acceptable

### Ingestion is Read-Only, Settlement is Deterministic
- Ingestion loads data into an `ingestion_events` table (immutable append-only log)
- Settlement applies events to scores (repeatable, deterministic)
- No raw ingestion data touches contest scores until settlement runs
- One ingestion error does not corrupt existing scores

### Single Responsibility
- `ingestionService` owns: fetching, parsing, validation (no scoring)
- `settlementService` owns: applying validated events to scores, computing final results
- `ingestionAuditLog` owns: recording every ingestion event for replay and debugging
- Clear separation; no service handles multiple concerns

---

## SOLID Enforcement

### Single Responsibility Boundaries
- **ingestionService**: Fetch from provider, parse format, validate schema, store in event log
- **ingestionValidator**: Validate provider data against schema (no database writes)
- **settlementService**: Apply validated ingestion events to contest scores
- **auditLog**: Record every ingestion event, every score update, every settlement

**Document these boundaries** in `/backend/services/ingestionService/CLAUDE.md` and `/backend/services/settlementService/CLAUDE.md`

### Explicit Interfaces
- `ingestionService.fetch(providerId, eventType)` → raw provider data (no parsing)
- `ingestionValidator.validate(rawData, schema)` → `{ valid: bool, errors: string[], data: {} }`
- `settlementService.applyEvent(contestId, validatedEvent)` → `{ success: bool, scores: {} }`
- `auditLog.record(event, metadata)` → stores immutable entry

### No Hidden Coupling
- ingestionService does not call settlementService
- settlementService does not call ingestionService
- Coupling happens only in routes/orchestration layer
- Each service is testable in isolation

### Dependency Direction
```
routes → ingestionController → ingestionService
                            → ingestionValidator
       → settlementController → settlementService
                            → auditLog
```
No circular dependencies; no service calls its caller.

### Retry and Timeout Policy

External provider calls must be resilient and bounded.

- **Timeout at 5 seconds**: All provider API calls must timeout if no response within 5 seconds. Long-running ingestion queries are provider responsibility, not client responsibility.
- **Retry up to 3 times**: Failed calls retry automatically up to 3 times. Retry only on network/timeout errors (5xx status, connection reset, timeout).
- **Never retry validation failures or schema mismatches**: 4xx errors (400, 401, 403, 404), malformed responses, or schema validation errors are not retried. Log failure and escalate to ops.
- **Exponential backoff**: Retry delays are exponential (e.g., 1s, 2s, 4s). Prevents thundering herd if provider is slow to recover.
- **All retries must be logged**: Every retry attempt is logged with `[Ingestion]` prefix, contest_id, provider, error type, and attempt number.

Example log format: `[Ingestion] contest_id=abc123 provider=PGA attempt=2/3 timeout_ms=5000 retry_ms=2000`

### Structured Logging Standard

All logs must use consistent prefixes and include contest context where applicable.

**Required logging prefixes** (scope each log to its domain):
- `[Auth]`: Authentication and authorization events
- `[Ingestion]`: Provider ingestion, validation, retry logic
- `[Settlement]`: Settlement computation and replay
- `[Payment]`: Payment collection, webhook events, ledger entries
- `[Payout]`: Payout requests and execution
- `[Lifecycle]`: Contest state transitions (SCHEDULED → LOCKED → LIVE → COMPLETE)
- `[Admin]`: Admin operations, config changes, manual interventions

**All logs must include context** where applicable:
- `contest_id`: UUID of contest (almost all logs)
- `user_id`: UUID of user (auth, payment, participation events)
- `request_id`: Trace ID for correlation across services
- Timestamp: ISO 8601 format
- Severity: DEBUG, INFO, WARN, ERROR

Example: `[Ingestion] contest_id=abc123 request_id=xyz789 event=validation_failed schema_version=2 error="missing_field: player_id"`

---

## Data Model Impact

### Schema Changes Required
- `ingestion_events` table: immutable append-only log of all provider data
- `ingestion_validation_errors` table: all validation failures with full context
- `settlement_audit` table: record of every settlement run and its inputs/outputs
- `score_history` table: versioned scores with timestamp and settlement run ID

### Fields on ingestion_events
```
id, contest_id, event_type, provider_data_json, received_at,
validated_at, validation_status, validation_errors_json, created_at
```

### Fields on settlement_audit
```
id, contest_id, settlement_run_id, engine_version (string, required),
event_ids_applied (array), started_at, completed_at, status,
error_json, final_scores_json
```
- `engine_version`: Identifies which settlement engine version produced this result (enables audit across scoring logic changes)

### Critical Constraints
- Ingestion events are immutable: If an event is wrong, it stays in the log; settlement simply doesn't apply it
- Corrections are new events, not edits: This enables replay and debugging
- **Terminal Event Lock**: Once final settlement run is marked COMPLETE, no new ingestion_events may apply to that contest unless explicitly re-opened by admin action. This prevents silent score drift after contest completion.

---

## Contract Impact

### Breaking Changes (None Intentional)
- Score endpoints must include settlement run ID in response
- Score responses must include `score_history` or latest score only (explicit)
- Existing score retrieval endpoints remain unchanged

### New Contracts
- `GET /api/admin/contests/:id/ingestion-events` → returns event log
- `GET /api/admin/contests/:id/validation-errors` → returns all validation failures
- `POST /api/admin/contests/:id/settlement-run` → triggers settlement (admin only)
- `GET /api/admin/contests/:id/settlement-audit/:runId` → returns settlement details

---

## Validation Rules

### Ingestion Validation (Before Recording)
1. Provider data conforms to expected schema (e.g., required fields present)
2. All player IDs reference valid contest participants
3. No timestamp conflicts (same player update twice in one fetch)
4. Scores are within valid range (0-120 for golf, etc.)
5. Data is internally consistent (leaderboard order matches scores)
6. **Provider round number ≤ configured round_count**: If provider returns round index greater than configured maximum, ingestion fails loud with error message

### Settlement Validation
1. Only validated events are applied
2. Settlement runs are idempotent (re-running produces identical results)
3. No event can be applied twice
4. Score corrections preserve history (old score version is retained)

### Silent Failures Not Allowed
- Invalid ingestion data is recorded in `ingestion_validation_errors`
- Settlement does not skip invalid events; it fails loud with full context
- Validation failures include: what failed, why, and what action is required

---

## Failure Modes

### Ingestion Failures
- **Invalid schema**: Event is logged as validation failure; not applied to scores; ops is alerted
- **Missing participant**: Event rejected; logged with context; ops must reconcile
- **Timestamp conflict**: Both events logged; settlement fails; ops must choose which is canonical

### Settlement Failures
- **Event validation fails mid-settlement**: Settlement transaction rolls back; no partial scores
- **Score calculation crashes**: Caught, logged with full context, settlement fails
- **Data drift between ingestion and settlement**: Detected and logged; settlement stops; manual review required

### Recovery
- Ingestion failure: Validate root cause; fix source data; re-ingest (new event)
- Settlement failure: Review logs; validate data; run settlement again from checkpoint
- All recovery is auditable and repeatable

---

## Unit Test Requirements

### Ingestion Service Tests
- `ingestionService.fetch()` stores raw provider data unchanged
- `ingestionValidator.validate()` rejects invalid schema with specific error
- `ingestionValidator.validate()` rejects missing required fields
- `ingestionValidator.validate()` rejects score out of range
- `ingestionValidator.validate()` accepts valid data without modification

### Settlement Service Tests
- `settlementService.applyEvent()` applies valid event to scores
- `settlementService.applyEvent()` rejects invalid event with error
- Replaying identical events produces identical scores
- Settlement transactions are atomic (all-or-nothing)
- Settlement cannot apply an event twice

### Audit Log Tests
- Every ingestion event is recorded with timestamp
- Every validation error is recorded with context
- Every settlement run is recorded with inputs and outputs
- Audit log is append-only (no edits, only new records)

### Failure Case Tests
- Invalid provider data is rejected with specific error
- Missing participant data is logged and stops settlement
- Settlement failure rolls back all partial changes
- Replay of settlement from checkpoint produces identical results
- No silent corrections or partial success

### No Silent Parsing Tests
- Malformed JSON is explicitly rejected
- Missing fields are explicitly rejected
- Invalid data types are explicitly rejected
- Out-of-range values are explicitly rejected

---

## Completion Criteria

✓ Ingestion events table exists with proper schema
✓ Settlement audit table exists with full context
✓ Ingestion validation logic is unit tested and deterministic
✓ Settlement logic is unit tested and replay-safe
✓ All validation failures are explicit with clear error messages
✓ Audit log is append-only and immutable
✓ Settlement transactions are atomic
✓ Replay of settlement produces identical results
✓ No silent failures; all errors are logged with context
✓ Schema snapshot is updated and committed
✓ No undocumented assumptions remain

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Decisions For Next Iteration
(Document architectural choices that affect iteration 03)

### Provider-Specific CLAUDE.md
(Document links to provider-specific governance files)

---

## Next Steps

Once this iteration closes:
- Iteration 03 begins: Backend Contract Freeze + Canonical Documentation
- Ingestion becomes repeatable and auditable
- Settlement becomes deterministic and replay-safe
- No further changes to ingestion structure without explicit iteration plan
