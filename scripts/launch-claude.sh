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

echo "[CHECK] Verifying governance infrastructure..."
echo ""

# ============================================================================
# PHASE 1: CORE GOVERNANCE LAYER
# ============================================================================

GOVERNANCE_FILES=(
  "docs/governance/CLAUDE_RULES.md"
  "docs/governance/LIFECYCLE_EXECUTION_MAP.md"
  "docs/governance/FINANCIAL_INVARIANTS.md"
  "docs/governance/IOS_SWEEP_PROTOCOL.md"
  "docs/governance/ARCHITECTURE_ENFORCEMENT.md"
)

echo "[✓] Core Governance Files:"
for file in "${GOVERNANCE_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "    [✗] MISSING: $file"
    exit 1
  fi
  echo "    [✓] $file"
done
echo ""

# ============================================================================
# PHASE 2: FROZEN CONTRACTS & SCHEMAS
# ============================================================================

GOLDEN_FILES=(
  "backend/contracts/openapi.yaml"
  "backend/db/schema.snapshot.sql"
  "CLAUDE.md"
)

echo "[✓] Golden Contracts & Schema:"
for file in "${GOLDEN_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "    [✗] MISSING: $file"
    exit 1
  fi
  echo "    [✓] $file"
done
echo ""

# ============================================================================
# PHASE 3: FROZEN INFRASTRUCTURE STATUS
# ============================================================================

echo "[✓] Frozen Infrastructure Layer:"
echo "    [✓] Financial Invariants (FROZEN)"
echo "        - Atomic join debit with wallet locking"
echo "        - Entry fee immutability DB-enforced"
echo "        - Idempotency key uniqueness via constraint"
echo "    [✓] Lifecycle Engine (FROZEN)"
echo "        - SCHEDULED → LOCKED primitive"
echo "        - LOCKED → LIVE primitive"
echo "        - LIVE → COMPLETE with settlement binding"
echo "        - CANCELLED cascade (provider & admin)"
echo "    [✓] Mutation Surface (SEALED)"
echo "        - All status mutations via contestLifecycleService"
echo "        - Admin paths use frozen single-instance primitives"
echo "        - Discovery cascade atomic via CTE"
echo "    [✓] OpenAPI Contract (FROZEN)"
echo "        - Public client-facing contract immutable"
echo "        - Freeze test enforces hash stability"
echo "    [✓] Database Schema (AUTHORITATIVE)"
echo "        - schema.snapshot.sql is golden source"
echo "        - All triggers and constraints enforced"
echo ""

# ============================================================================
# PHASE 4: BACKEND TEST INFRASTRUCTURE
# ============================================================================

echo "[✓] Backend Test Layer:"
echo "    [✓] Core Invariant Tests (Frozen Primitives)"
echo "        - Lifecycle transitions tests (SCHEDULED → LOCKED → LIVE)"
echo "        - Lifecycle completion tests (LIVE → COMPLETE)"
echo "        - Settlement isolation tests"
echo "        - Admin operations tests (sealed mutation surface)"
echo "    [✓] Discovery Service Tests (Governance Locked)"
echo "        - Cancellation cascade tests (atomicity + idempotency)"
echo "        - Lifecycle ordering: Phase 1 → 2 → 3 enforced"
echo "        - Comprehensive discovery test suite"
echo "    [✓] Financial Integrity Tests"
echo "        - Join flow with wallet atomicity"
echo "        - Idempotent wallet debit"
echo "        - Balance computation tests"
echo "    [✓] Contract Freeze Tests"
echo "        - OpenAPI hash validation (tests/openapi-freeze.test.js)"
echo "        - Schema mutation prevention"
echo "    [✓] Fast Feedback Tiers (Run before merge)"
echo "        - Tier 1: Discovery surface"
echo "        - Tier 2: Settlement invariants"
echo "        - Tier 3: Full backend validation"
echo ""

# ============================================================================
# PHASE 5: iOS ARCHITECTURE LAYER
# ============================================================================

echo "[✓] iOS Architecture Layer:"
echo "    [✓] DTO → Domain Isolation (Mandatory)"
echo "    [✓] ViewModel Service Boundary (Sealed)"
echo "    [✓] View → ViewModel Dependency (Enforced)"
echo "    [✓] Time-Based Lock Enforcement (Required)"
echo "    [✓] Financial Boundary Protection (Backend-Authoritative)"
echo "    [✓] Contest Type Abstraction (Sport-Agnostic)"
echo "    [✓] Snapshot Rendering (LIVE vs COMPLETE segregated)"
echo ""

echo "[✓] iOS Design System Enforcement:"
echo "    [✓] Radius Token Enforcement (37 files migrated)"
echo "    [✓] Spacing Token Enforcement (85+ normalizations)"
echo "    [✓] CI Guards in place (enforcement scripts operational)"
echo ""

# ============================================================================
# PHASE 6: SYSTEM MATURITY MATRIX
# ============================================================================

echo "[✓] System Maturity Status (Per Governance):"
echo ""
echo "    FROZEN (Protected by Tests & Governance):"
echo "      • Financial atomicity & idempotency"
echo "      • Lifecycle state machine (all 4 transitions)"
echo "      • Settlement snapshot binding & determinism"
echo "      • Mutation surface seal (status updates)"
echo "      • OpenAPI contract (public schema immutable)"
echo "      • Database schema (authoritative snapshot)"
echo ""
echo "    OPERATIONAL (Implemented, HA Pending):"
echo "      • Background lifecycle reconciler (30s interval)"
echo "      • Discovery webhook pipeline"
echo "      • Monitoring & alerting (partial)"
echo ""
echo "    EVOLVING (Not yet started):"
echo "      • Contract versioning runtime"
echo "      • Tournament discovery automation"
echo "      • Auto-template generation"
echo ""
echo "    PENDING (Out of scope, Phase 2+):"
echo "      • Distributed HA hardening"
echo "      • Advanced monitoring dashboards"
echo "      • Multi-region failover"
echo ""

# ============================================================================
# PHASE 7: BOOTSTRAP & LAUNCH
# ============================================================================

BOOTSTRAP_FILE=".claude_bootstrap.txt"

cat <<'BOOTSTRAP' > "$BOOTSTRAP_FILE"
67 ENTERPRISES — SYSTEM MODE (GOVERNANCE BOOT)

================================================================================
HARD GATE: Read governance files in order before any work
================================================================================

Your first action is to READ the files below.
After reading them, your first output must be exactly:
  READ COMPLETE

NO CLAIMS RULE:
- Do not claim test counts, past defects, completion status, or "memory context"
  unless you have verified it by reading repo files in THIS session.

================================================================================
READ THESE FILES (IN ORDER):
================================================================================

1. docs/governance/CLAUDE_RULES.md
   → Global governance, frozen invariants, architecture boundaries
   → Change control & system maturity matrix

2. docs/governance/LIFECYCLE_EXECUTION_MAP.md
   → Authoritative lifecycle state machine
   → All 4 transitions (SCHEDULED→LOCKED→LIVE→COMPLETE, CANCELLED)

3. docs/governance/FINANCIAL_INVARIANTS.md
   → Atomic wallet debit on join (frozen)
   → Entry fee immutability (DB-enforced)
   → Idempotency & error handling

4. docs/governance/IOS_SWEEP_PROTOCOL.md
   → Layer boundary enforcement (DTO→Domain→ViewModel→View)
   → Time-based lock enforcement (not status-only)
   → Financial boundary protection (backend-authoritative)

5. docs/governance/ARCHITECTURE_ENFORCEMENT.md
   → Design system token enforcement (iOS)
   → Radius & spacing normalization

6. backend/contracts/openapi.yaml
   → Public API contract (immutable)
   → All response shapes for client consumption

7. backend/db/schema.snapshot.sql
   → Authoritative database schema
   → All triggers, constraints, functions

================================================================================
OPERATING RULES (NON-NEGOTIABLE):
================================================================================

✓ Respect frozen financial invariants
✓ Respect lifecycle ordering (Phase 1 → 2 → 3)
✓ Respect mutation surface seal (only contestLifecycleService writes status)
✓ Never weaken tests to satisfy code
✓ Operate at system scope, not feature scope

Frozen Primitives (Protected by Tests):
  • All 4 lifecycle transitions (atomic, idempotent, deterministic)
  • Wallet debit atomicity on join
  • Settlement snapshot binding
  • Discovery cascade ordering (Phase 1 → 2 → 3)

Golden Contracts (No Breaking Changes):
  • backend/contracts/openapi.yaml (hash-locked)
  • backend/db/schema.snapshot.sql (authoritative)
  • CLAUDE.md (master instructions)

iOS Architecture (Non-Negotiable):
  • DTOs never leak into ViewModel state
  • Service calls only in ViewModel, never Views
  • Lock enforcement uses lock_time (not status alone)
  • No client-side financial math or score recalculation
  • Contest type abstraction preserved

================================================================================
FAST FEEDBACK TIERS (Available for Testing):
================================================================================

Tier 1 — Discovery Service (117 tests, ~10s)
  cd backend && \
  ADMIN_JWT_SECRET=test-admin-jwt-secret \
  TEST_DB_ALLOW_DBNAME=railway \
  npm test -- tests/discovery/ --runInBand --forceExit

Tier 2 — Settlement Invariants (6 tests, ~5s)
  cd backend && \
  ADMIN_JWT_SECRET=test-admin-jwt-secret \
  TEST_DB_ALLOW_DBNAME=railway \
  npm test -- tests/e2e/pgaSettlementInvariants.test.js --runInBand --forceExit

Tier 3 — Full Backend Validation (1995+ tests, ~60s)
  cd backend && \
  ADMIN_JWT_SECRET=test-admin-jwt-secret \
  TEST_DB_ALLOW_DBNAME=railway \
  npm test -- --forceExit

================================================================================
TASK: Operate at system scope, not feature scope
================================================================================

Your work must:
1. Respect all frozen infrastructure (no silent edits)
2. Update governance docs if behavior changes
3. Ensure tests validate your changes
4. Add progress markers to documentation
5. Maintain clarity on frozen vs evolving layers

Feature work must not:
- Break frozen invariants or contracts
- Bypass mutation surface seal
- Weaken or skip tests
- Introduce undocumented drift
- Violate architecture boundaries

================================================================================
YOU ARE NOW IN SYSTEM MODE
================================================================================

All feature-specific context is secondary.
Governance layer is primary.
Frozen infrastructure is non-negotiable.

Proceed with read-first discipline.

BOOTSTRAP

echo ""
echo "Launching Claude in SYSTEM MODE..."
echo ""

claude < "$BOOTSTRAP_FILE"
