# 67 ENTERPRISES — AI WORKER RULES

Workers must read this document immediately after AI_ENTRYPOINT.md.

This file defines behavioral rules for AI workers.

---

# Core Principle

Workers must operate deterministically.

Workers must:

• avoid repository scanning
• avoid token waste
• avoid architectural drift
• avoid unauthorized edits

---

# Ledger Immutability

Workers must never delete or modify existing ledger rows.

All financial corrections must use compensating ledger entries.

Ledger entries are append-only and immutable.

---

# Balance Mutation Forbidden

Workers must never mutate wallet balances directly.

All balance changes must occur through ledger entries.

Balances are derived from ledger sums and must never be written as mutable fields.  

---

# Absolute Path Rule

Workers must only use absolute file paths.

Example:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/services/contestService.js

Workers must never construct paths like:

./backend/services  
backend/services  
$REPO_ROOT/backend/services  

---

# Edit Containment Rule

Workers may only modify files inside directories explicitly listed in AI_ENTRYPOINT.md.

If a required change affects files outside allowed directories, workers must STOP and request approval.

Workers must never edit files outside allowed lanes.

---

# Schema First Rule

Database schema is authoritative.

Source of truth:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql

If a requested change requires schema modification:

Workers must stop and reply only:

Schema change required before code change.

Workers must not implement code assuming schema changes.

---

# API Contract Authority

API shapes are defined by:

/Users/iancarter/Documents/workspace/playoff-challenge/backend/contracts/openapi.yaml

Workers must not change response shapes unless OpenAPI is updated first.

---

# Test First Rule

All new behavior must begin with tests.

Required order:

1. Write tests
2. Run tests
3. Implement code
4. Run tests again

---

# Test Authority

Workers must never:

• remove tests  
• weaken assertions  
• bypass failing tests  

If tests fail, fix the implementation.

---

# Execution Protocol

Workers must follow this sequence.

1. Read AI_ENTRYPOINT.md
2. Read AI_WORKER_RULES.md
3. Read governance docs (in order from AI_ENTRYPOINT.md Step 2)
   - **CRITICAL FOR FINANCIAL WORK:** Read LEDGER_ARCHITECTURE_AND_RECONCILIATION.md before implementing any ledger operations
4. Write tests
5. Run tests
6. Implement changes
7. Run tests again
8. If failing → fix implementation
9. If passing → return summary

---

# Backend Test Command

Workers must use this exact command:

cd /Users/iancarter/Documents/workspace/playoff-challenge/backend && TEST_DB_ALLOW_DBNAME=railway npm test -- --runInBand --forceExit

---

# iOS Commands

Build:

cd /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge && swift build

Test:

cd /Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge && swift test

---

# Forbidden Actions

Workers must never:

• run git commands  
• scan the repository  
• modify schema without approval  
• edit files outside allowed lanes  
• introduce business logic into SwiftUI Views  

---

# Output Format

If schema change required:

Schema change required before code change.

Otherwise return:

Files changed:
• absolute paths

Behavior changes:
• bullet list

Test command run:
• command used

Test result:
• PASS

