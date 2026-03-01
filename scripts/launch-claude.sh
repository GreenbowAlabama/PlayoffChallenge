#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/iancarter/Documents/workspace/playoff-challenge"

echo ""
echo "==============================================="
echo "        67 ENTERPRISES — SYSTEM MODE"
echo "==============================================="
echo ""

cd "$ROOT" || {
  echo "ERROR: Could not change to project root."
  exit 1
}

REQUIRED_FILES=(
  "docs/governance/CLAUDE_RULES.md"
  "docs/governance/LIFECYCLE_EXECUTION_MAP.md"
  "docs/governance/FINANCIAL_INVARIANTS.md"
  "docs/governance/IOS_SWEEP_PROTOCOL.md"
  "docs/governance/ARCHITECTURE_ENFORCEMENT.md"
  "backend/contracts/openapi.yaml"
  "backend/db/schema.snapshot.sql"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: Missing required governance file: $file"
    exit 1
  fi
done

echo "Governance files verified."
echo ""
echo "System Status:"
echo "  - Financial Invariants: FROZEN"
echo "  - Lifecycle Engine: FROZEN"
echo "  - Mutation Surface: SEALED"
echo "  - OpenAPI Contract: FROZEN"
echo ""

BOOTSTRAP_FILE=".claude_bootstrap.txt"

cat <<'BOOTSTRAP' > "$BOOTSTRAP_FILE"
67 ENTERPRISES — SYSTEM MODE (GOVERNANCE BOOT)

HARD GATE:
- Your first action is to READ the files below.
- After reading them, your first output must be exactly:
  READ COMPLETE

NO CLAIMS RULE:
- Do not claim test counts, past defects, completion status, or “memory context”
  unless you have verified it by reading repo files in THIS session.

READ THESE FILES (IN ORDER):
1. docs/governance/CLAUDE_RULES.md
2. docs/governance/LIFECYCLE_EXECUTION_MAP.md
3. docs/governance/FINANCIAL_INVARIANTS.md
4. docs/governance/IOS_SWEEP_PROTOCOL.md
5. docs/governance/ARCHITECTURE_ENFORCEMENT.md
6. backend/contracts/openapi.yaml
7. backend/db/schema.snapshot.sql

OPERATING RULES:
- Respect frozen financial invariants
- Respect lifecycle ordering (Phase 1 → 2 → 3)
- Respect mutation surface seal
- Never weaken tests to satisfy code
- Operate at system scope, not feature scope
BOOTSTRAP

echo "Launching Claude in SYSTEM MODE..."
echo ""

claude < "$BOOTSTRAP_FILE"
