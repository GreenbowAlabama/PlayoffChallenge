# Archive — Historical & Redundant Documentation

This folder contains governance and planning documents that have been consolidated or superseded by active iteration documents.

## Contents

### Governance Review Files (Superseded by LESSONS-LEARNED.md)
- `iteration-01-governance-review.md` — Iteration 01 governance audit; findings captured in LESSONS-LEARNED.md
- `iteration-02-governance-review.md` — Iteration 02 governance audit; findings captured in LESSONS-LEARNED.md
- `iteration-04-governance-review.md` — Iteration 04 governance audit; findings captured in LESSONS-LEARNED.md

**Why archived**: Governance reviews are one-time audits. Key findings and anti-patterns are now in LESSONS-LEARNED.md, which is the active reference document for governance standards.

### Phase Planning Documents (Consolidated into Iteration Docs)
- `03-phase-03-stripe-webhook.md` — Phase 03 execution plan; details now in 03-iteration-03-payment-integration.md
- `04-phase-04-hardening-targets.md` — Phase 04 testing targets; structure now in 04-iteration-04-contract-freeze.md
- `05-phased-approach.md` — Phase 05 breakdown (05A/B/C/D); architecture now in 05-iteration-05-automatic-payout.md

**Why archived**: Phase planning is execution strategy. The architectural decisions and final implementations are documented in the primary iteration files. Phase documents were intermediate planning; iteration files are the canonical reference.

### Implementation Status (Merged into Iteration Doc)
- `05-IMPLEMENTATION-STATUS.md` — Implementation tracking for Iteration 05; merged into 05-iteration-05-automatic-payout.md

**Why archived**: This was active tracking during iteration 05 development. Upon iteration completion, blocker status and implementation details were consolidated into the primary iteration document. Single source of truth is 05-iteration-05-automatic-payout.md.

---

## How to Use This Archive

1. **Reference for historical context**: If you need to understand *how* a decision was made, these files provide execution context.
2. **Lessons learned review**: Governance reviews are useful for understanding anti-patterns; refer to LESSONS-LEARNED.md for the consolidated findings.
3. **Decision rationale**: If a phase doc contains unique architectural reasoning, that decision should be in the parent ../DECISION-LOG.md.

---

## When to Read Archive Files

- You're investigating a historical decision and need full context
- You're onboarding and want to understand iteration execution patterns
- You're researching governance audit procedures

## When NOT to Read Archive Files

- Looking for current governance standards → read `../LESSONS-LEARNED.md`
- Looking for iteration specifications → read `../0X-iteration-0X-*.md` files
- Looking for architectural decisions → read `../DECISION-LOG.md`
- Building on the hardening program → read `../00-program-overview.md`

---

**Archived**: 2026-02-16
**Reason**: Documentation consolidation and governance cleanup
