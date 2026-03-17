# Governance Version Control

**Governance Version:** 3
**Architecture Lock:** ACTIVE
**Effective Date:** 2026-03-17
**Last Updated:** 2026-03-17

---

## Purpose

This file tracks governance versioning. Any modification to frozen primitives requires incrementing the version number and updating ARCHITECTURE_LOCK.md.

---

## Frozen Primitives (Require Version Increment)

Changes to any of these require:
1. Increment Governance Version (1 → 2, etc.)
2. Update this file (Governance Version, Last Updated, Change Summary)
3. Update ARCHITECTURE_LOCK.md with new effective date and change rationale
4. Explicit architect authorization documented in change summary

**Frozen Systems:**
- `backend/db/schema.snapshot.sql`
- `backend/contracts/openapi.yaml`
- `backend/contracts/openapi-admin.yaml`
- Ledger architecture (`docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`)
- Lifecycle states (`docs/governance/LIFECYCLE_EXECUTION_MAP.md`)
- Governance rules (`docs/governance/CLAUDE_RULES.md`, `docs/ai/*`)

---

## Change History

### Version 1 (2026-03-12)
- Initial governance freeze
- Architecture Lock activated
- Financial invariant frozen: wallet_liability + contest_pools = deposits - withdrawals
- Contest lifecycle frozen: SCHEDULED, LOCKED, LIVE, COMPLETE, CANCELLED, ERROR
- All 6 core systems locked
- Worker escalation protocol installed

### Version 3 (Active)

**Status:** ACTIVE
**Snapshot ID:** b50ff7e0-77e0-421f-a96a-4a1cb34a2745
**Contract:** public-api

- OpenAPI contract additions: Stripe account linking endpoints
  - POST /api/user/stripe-account/onboarding-link
  - GET /api/user/stripe-account/status
  - GET /api/user/stripe-account/callback
- New schemas: StripeOnboardingLinkResponse, StripeAccountStatusResponse, StripeAccountCallbackRequest, StripeAccountCallbackResponse
- State token CSRF protection for OAuth callbacks
- Account ownership rules enforced (one-to-one user ↔ Stripe account binding)
- Contract frozen via `npm run freeze:openapi`

---

## Authorization Required

To increment version, the following must occur:

1. **Change Request** — Engineer/architect identifies need to modify frozen primitive
2. **Impact Analysis** — Document impact on financial invariants, reconciliation, state machine
3. **Architect Approval** — Explicit written approval with rationale
4. **Version Increment** — Update this file and ARCHITECTURE_LOCK.md
5. **Implementation** — Worker implements only after approval
6. **Verification** — All tests pass, no governance violations introduced

---

## Single Source of Truth

This file is the single source of truth for governance state.

If you see **Governance Version: 1** and **Architecture Lock: ACTIVE**, the system is frozen at the primitives listed above.

Future versions (2, 3, etc.) will document what changed and why.
