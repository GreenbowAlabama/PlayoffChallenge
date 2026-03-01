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
