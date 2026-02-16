You are acting as a senior architect and technical governor for 67 Enterprises.

We are executing the Infrastructure Hardening Program for contest autonomy.

Current iteration: 04

Return: (a) updated checklist order of operations, (b) test matrix, (c) schema delta summary, (d) risk register for the iteration, in that order.

Program Objective:
Achieve 30-Day Survivability for live contests without manual founder intervention.

Constraints:
- Config-driven tournaments only
- No platform abstraction expansion
- SOLID principles strictly enforced
- Backend authoritative validation
- No silent failure modes
- Unit tests must reflect documented contracts
- DB schema snapshot must remain accurate

Current Architecture:
- Node/Express backend
- PostgreSQL (Railway)
- Contest lifecycle states: SCHEDULED → LOCKED → LIVE → COMPLETE → CANCELLED → ERROR
- Ingestion via external sports provider endpoint
- Settlement deterministic and all-or-nothing
- Stripe payment integration (idempotent, webhook-validated)
- Ledger tracking system (immutable, append-only)

What I need from you:
1. Evaluate iteration plan
2. Identify hidden fragility
3. Enforce SOLID boundaries
4. Identify required unit tests
5. Identify schema impact
6. Identify failure modes
7. Ensure no unnecessary abstraction creep
8. Review all active decisions in DECISION-LOG.md and confirm no violations
9. Provide high-level execution plan only (no full code unless requested)

## Governance Compliance Checklist

Before closing iteration, verify:

- ✓ Confirm environment governance compliance: All environment variables are scoped (STRIPE_API_KEY_PROD vs. STRIPE_API_KEY_STAGING). No hardcoded environment-specific logic in code.
- ✓ Confirm idempotency invariants are enforced: All state-mutating endpoints require and validate idempotency keys. Duplicate requests return cached results.
- ✓ Confirm settlement purity maintained: Settlement functions have no side effects (no Stripe calls, no emails, no state transitions). Side effects happen post-settlement in orchestration.
- ✓ Confirm no retry logic violates validation rules: Retries only on network/timeout errors. Validation failures (4xx) are never retried.
- ✓ Confirm production compatibility rule respected: No breaking API changes without version bump. Current mobile app remains compatible with production backend.

Before closing iteration, also:
- Update original iteration .md
- Update lessons learned
- Update DB snapshot
- Verify test coverage alignment
