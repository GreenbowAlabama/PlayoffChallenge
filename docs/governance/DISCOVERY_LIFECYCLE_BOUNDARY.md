# Discovery ↔ Lifecycle Boundary Contract
Status: FROZEN AFTER APPROVAL
Scope: Prevent coupling drift between provider ingestion and lifecycle engine

---

## 1. Purpose

This document defines the strict boundary between:

- Discovery Service (external provider ingestion)
- Lifecycle Engine (internal contest state transitions)

The goal is to:
- Prevent temporal mutation drift
- Prevent implicit lifecycle side effects
- Preserve deterministic transition guarantees
- Maintain replay safety

---

## 2. Ownership Model

### Discovery Owns:
- Provider tournament metadata
  - provider_tournament_id
  - provider_status
  - provider_start_time
  - provider_end_time
- Template-level state
- Provider cancellation cascade trigger
- Template name updates (pre-LOCKED only)

### Lifecycle Owns:
- contest_instances.status
- lock_time
- tournament_start_time (instance-level copy)
- tournament_end_time (instance-level copy)
- State transitions (SCHEDULED → LOCKED → LIVE → COMPLETE)
- Error escalation
- Settlement triggering

Discovery must NOT mutate instance lifecycle state directly.

---

## 3. Temporal Authority Rules

### 3.1 Canonical Time Source

Provider start and end times originate from discovery.

However:

- They are copied into contest_instances at creation time.
- After instance creation, instance-level times are authoritative.
- Discovery does NOT mutate instance-level times after instance creation.

Reason:
Lifecycle determinism requires stable timestamps.

---

### 3.2 Instance Immutability Rule

Discovery may NOT:
- Update contest_instances.tournament_start_time
- Update contest_instances.tournament_end_time
- Update contest_instances.lock_time
- Update contest_instances.status

Exception:
Provider cancellation cascade may update instance.status → CANCELLED
(as already frozen in governance).

---

## 4. Creation Authority

### Discovery MAY:
- Create contest_templates (auto-template generation)

### Discovery MUST NOT:
- Create contest_instances automatically (Phase 1 constraint)

Instance creation remains:
- Admin-driven
- Explicit
- Intentional

This prevents uncontrolled lifecycle propagation.

---

## 5. Cancellation Ordering

If provider_status = CANCELLED:

1. Discovery updates template.status = CANCELLED
2. Discovery cascades all non-terminal instances → CANCELLED
3. Lifecycle reconciler must NOT override CANCELLED
4. COMPLETE contests remain immutable

This ordering is already frozen.

---

## 6. Lifecycle Independence Rule

Lifecycle engine must remain operable even if discovery:
- Stops running
- Fails
- Returns partial data
- Delays provider updates

Lifecycle operates strictly on:
- contest_instances
- Injected "now"

It must not depend on discovery being active.

---

## 7. Admin Override Policy

Admin may override:
- contest_instance status via frozen primitives

Admin may NOT:
- Modify provider times post-publish
- Modify entry_fee_cents post-publish (DB-enforced)

---

## 8. Replay & Determinism Guarantee

Discovery replays must:
- Be idempotent
- Never create duplicate transitions
- Never alter instance-level temporal fields

Lifecycle replays must:
- Produce identical transitions given same timestamps
- Never depend on discovery state at runtime

---

## 9. Phase 1 Constraint (Important)

Auto-instance generation from discovery is NOT permitted in Phase 1.

Reason:
Instance creation introduces lifecycle coupling risk.

This may be revisited in Phase 3+ with explicit governance review.

---

## 10. Governance Violation Definition

The following actions are violations:

- Discovery directly updating contest_instances.status (except cancellation cascade)
- Discovery modifying instance-level times
- Lifecycle reading provider tables during transitions
- Instance auto-creation without explicit admin trigger

Violations require:
- Governance review
- Test updates
- Documentation updates

---

## 11. DISCOVERY PIPELINE INVARIANTS

The discovery pipeline is responsible for creating the complete system structure that enables contests to function.

Contest creation is not a single atomic operation. It is a cascading pipeline where each stage depends on the previous:

```
contest_instances
    ↓
tournament_configs
    ↓
field_selections
    ↓
player ingestion
    ↓
lineup submission
```

**Critical Rule:** contest_instances alone are NOT sufficient for a functional contest.

A contest is only operational when tournament_configs and field_selections have been successfully initialized.

### Invariant 1 — Contest Structural Completeness

**Rule:** Every contest_instance must have exactly one tournament_config.

**Verification Query:**

```sql
SELECT ci.id
FROM contest_instances ci
LEFT JOIN tournament_configs tc
  ON tc.contest_instance_id = ci.id
WHERE tc.id IS NULL;
```

**Interpretation:** If any rows return, discovery has failed. The contest instance exists but its configuration does not.

This represents a structural integrity violation.

### Invariant 2 — Tournament Config Initialization

**Rule:** tournament_configs must include all configuration fields populated at discovery time.

**Required Fields:**

- `contest_instance_id` — Foreign key to contest_instances
- `provider_event_id` — Identifier from external provider
- `ingestion_endpoint` — Where to fetch live scoring data
- `event_start_date` — Event begins (provider time)
- `event_end_date` — Event ends (provider time)
- `round_count` — Number of rounds in contest (e.g., 4 for golf)
- `cut_after_round` — Round number after which field is reduced (or NULL)
- `leaderboard_schema_version` — Version of scoring schema
- `field_source` — Source of field data (e.g., 'PROVIDER', 'MANUAL')
- `hash` — Content hash of configuration (for idempotency)

**Constraint:** All fields must be populated. NULL values in any required field indicate incomplete discovery.

### Invariant 3 — Field Selection Initialization

**Rule:** Every contest_instance must have one field_selections row.

**Verification Query:**

```sql
SELECT ci.id
FROM contest_instances ci
LEFT JOIN field_selections fs
  ON fs.contest_instance_id = ci.id
WHERE fs.id IS NULL;
```

**Interpretation:** If any rows return, the contest instance lacks field definitions. Lineup submission is impossible without field_selections.

### Invariant 4 — Idempotent Discovery

**Rule:** Discovery must be safe to run multiple times without creating duplicates.

**Implementation Pattern:**

All discovery pipeline operations must use:

```sql
INSERT INTO tournament_configs (...)
VALUES (...)
ON CONFLICT DO NOTHING;

INSERT INTO field_selections (...)
VALUES (...)
ON CONFLICT DO NOTHING;
```

**Rationale:**

- Discovery may be retried if network fails
- External sources may be polled multiple times
- The system must guarantee that re-running discovery produces identical state
- No duplicate tournament_configs
- No duplicate field_selections

---

## 12. AI WORKER SAFETY RULE — DISCOVERY SYSTEM

**Status:** MANDATORY — Workers must follow this rule without exception.

### When to Request Architect Approval

Workers must STOP and request architect approval BEFORE implementing any task that involves:

- Contest discovery logic
- tournament_configs creation
- field_selections initialization
- Ingestion pipeline architecture
- Scoring ingestion adapters
- Provider event ingestion
- Discovery orchestration

### What Workers Must NOT Do

Workers must NEVER:

- Modify discovery structure without governance review
- Skip tournament_configs creation
- Skip field_selections creation
- Create contests without full pipeline initialization
- Bypass discovery idempotency constraints
- Assume contest_instances alone are sufficient

### Rationale

The discovery system is a protected architectural boundary. Incomplete or partial implementations create structural corruption that:

- Breaks lineup submission (field_selections missing)
- Breaks scoring ingestion (tournament_configs missing)
- Requires manual database repair
- Violates determinism guarantees

Any task touching discovery must be reviewed by an architect to ensure full structural completeness.

---

## 13. RECOVERY PROCEDURE

If a contest_instance is created without accompanying tournament_configs or field_selections, the system is in a broken state.

### Detection

Run the verification queries from Invariants 1 and 3:

```sql
-- Missing tournament_config
SELECT ci.id
FROM contest_instances ci
LEFT JOIN tournament_configs tc
  ON tc.contest_instance_id = ci.id
WHERE tc.id IS NULL;

-- Missing field_selections
SELECT ci.id
FROM contest_instances ci
LEFT JOIN field_selections fs
  ON fs.contest_instance_id = ci.id
WHERE fs.id IS NULL;
```

### Correct Repair Method

The correct repair is to call:

```javascript
initializeTournamentField(contestInstanceId)
```

This function is responsible for:

1. Creating tournament_configs with provider metadata
2. Creating field_selections with initial field data
3. Triggering player ingestion pipeline
4. Validating structural completeness

### Why Not Manual SQL Creation?

Direct manual SQL creation of tournament_configs or field_selections is discouraged because:

- It bypasses idempotency constraints
- It may miss dependent initialization logic
- It violates the discovery pipeline order
- It requires domain knowledge of provider event metadata

The `initializeTournamentField()` function encapsulates this logic and ensures correctness.

### Prevention Going Forward

- All contest creation paths must call the complete discovery pipeline
- Tests must verify all three entities (contest_instances, tournament_configs, field_selections)
- Code review must catch partial implementations
- Workers must request architect approval for discovery changes
