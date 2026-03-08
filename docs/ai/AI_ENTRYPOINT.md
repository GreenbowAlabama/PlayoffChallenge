# 67 ENTERPRISES — AI ENTRYPOINT

This file is the canonical entrypoint for all AI workers (Claude, Gemini, ChatGPT).

Workers must read files in the exact order defined below.

Workers must not scan the repository.

Workers must only read files explicitly referenced here.

---

# Repository Root

/Users/iancarter/Documents/workspace/playoff-challenge

All paths referenced in this document are absolute.

Workers must not construct new paths.

---

# Step 1 — Worker Behavior Rules

Workers must read this file first:

/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md

This file defines behavioral rules and execution protocol.

---

# Step 2 — Governance (System Law)

These documents define the architecture and cannot be violated.

Read them in this order.

1.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/CLAUDE_RULES.md

2.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md

3.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LIFECYCLE_EXECUTION_MAP.md

4.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/FINANCIAL_INVARIANTS.md

5.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md

6.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/IOS_SWEEP_PROTOCOL.md

7.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/ARCHITECTURE_ENFORCEMENT.md

---

# Financial Invariant Awareness

Workers modifying financial code must ensure the reconciliation equation remains valid:

**wallet_liability + contest_pools = deposits - withdrawals**

This equation must hold at all times. If a proposed change risks breaking this equation, workers must STOP and report:

Financial invariant at risk.

Workers must not implement changes that could violate this equation without architect approval.

---

# Step 3 — Contracts and Schema

Workers must treat these files as authoritative.

OpenAPI contract

/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml

Database schema snapshot

/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql

If schema changes are required, workers must STOP and reply:

Schema change required before code change.

---

# Step 4 — Allowed Backend Lanes

Workers may read and edit files only inside these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/backend/services

/Users/iancarter/Documents/workspace/playoff-challenge/backend/routes

/Users/iancarter/Documents/workspace/playoff-challenge/backend/repositories

/Users/iancarter/Documents/workspace/playoff-challenge/backend/tests

Workers must not modify files outside these directories.

---

# Step 5 — Allowed iOS Lanes

Workers may read and edit files only inside these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Contracts

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/ViewModels

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Services

/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Views

Workers must follow the iOS sweep protocol.

---

# Optional Read Only

Workers may read but not modify these directories.

/Users/iancarter/Documents/workspace/playoff-challenge/core

/Users/iancarter/Documents/workspace/playoff-challenge/INTERNAL_DOCS/engineering_execution

