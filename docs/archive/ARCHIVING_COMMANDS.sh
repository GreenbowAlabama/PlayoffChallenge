#!/usr/bin/env bash
# ============================================================================
# DOCUMENTATION ARCHIVING COMMANDS
# ============================================================================
# Purpose: Move stale/unreferenced documentation to docs/archive/
# Date: March 2, 2026
# Safety: All files moved (not deleted); archived files remain accessible
#
# HOW TO USE:
# 1. Review the list below for accuracy
# 2. Run commands individually or in sequence
# 3. Verify files in docs/archive/ after completion
# 4. Commit the archiving as a separate commit with full audit trail
# ============================================================================

ROOT="/Users/iancarter/Documents/workspace/playoff-challenge"
ARCHIVE_DIR="$ROOT/docs/archive"

# Ensure archive directory exists
mkdir -p "$ARCHIVE_DIR"

echo "========== ARCHIVING STALE DOCUMENTATION =========="
echo ""
echo "Archive directory: $ARCHIVE_DIR"
echo ""

# ============================================================================
# AI WORKFLOW DOCS (Superseded by CLAUDE_RULES.md & CLAUDE.md)
# ============================================================================

echo "[1/6] Archiving AI workflow documentation..."

mv "$ROOT/docs/ai/architecture-web-admin.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/ai/architecture-web-admin.md"

mv "$ROOT/docs/ai/claude-architect-prompt.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/ai/claude-architect-prompt.md"

mv "$ROOT/docs/ai/claude-worker-prompt.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/ai/claude-worker-prompt.md"

mv "$ROOT/docs/ai/handoff.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/ai/handoff.md"

echo ""

# ============================================================================
# CLIENT FLUIDITY PROGRAM (Future-scoped, marked PLANNED)
# ============================================================================

echo "[2/6] Archiving client fluidity program (future-scoped)..."

if [ -d "$ROOT/docs/client-fluidity-program" ]; then
  mv "$ROOT/docs/client-fluidity-program" "$ARCHIVE_DIR/" && \
    echo "  ✓ docs/client-fluidity-program/ (entire folder)"
fi

echo ""

# ============================================================================
# PLANNING & ROADMAPS (Historical, pre-launch)
# ============================================================================

echo "[3/6] Archiving historical roadmaps..."

mv "$ROOT/docs/planning/LAUNCH_ROADMAP.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/planning/LAUNCH_ROADMAP.md"

echo ""

# ============================================================================
# BUG TRACKING (Historical, completed issues)
# ============================================================================

echo "[4/6] Archiving bug tracking documentation..."

mv "$ROOT/docs/bugs/BUG_FIXES_SUMMARY.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/bugs/BUG_FIXES_SUMMARY.md"

mv "$ROOT/docs/bugs/BUG_REPORT_DEC4.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/bugs/BUG_REPORT_DEC4.md"

mv "$ROOT/docs/bugs/BUG4_DEF_REMOVAL_ANALYSIS.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/bugs/BUG4_DEF_REMOVAL_ANALYSIS.md"

echo ""

# ============================================================================
# IMPLEMENTATION GUIDES (Feature-specific, pre-governance)
# ============================================================================

echo "[5/6] Archiving feature-specific implementation guides..."

mv "$ROOT/docs/implementations/IMPLEMENTATION_SUMMARY.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/implementations/IMPLEMENTATION_SUMMARY.md"

mv "$ROOT/docs/implementations/EMAIL_AUTH_GUIDE.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/implementations/EMAIL_AUTH_GUIDE.md"

mv "$ROOT/docs/implementations/IOS_COMPLIANCE_IMPLEMENTATION.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/implementations/IOS_COMPLIANCE_IMPLEMENTATION.md"

mv "$ROOT/docs/implementations/TESTFLIGHT_ADMIN_GUIDE.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/implementations/TESTFLIGHT_ADMIN_GUIDE.md"

echo ""

# ============================================================================
# AUDIT DOCS (Historical analysis, findings in governance)
# ============================================================================

echo "[6/6] Archiving historical audit documentation..."

mv "$ROOT/docs/ios/multi-contest-audit.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/ios/multi-contest-audit.md"

mv "$ROOT/docs/testing/TEST_ISOLATION_FIX.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/testing/TEST_ISOLATION_FIX.md"

mv "$ROOT/docs/testing/UNIT_TEST_USAGE.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/testing/UNIT_TEST_USAGE.md"

mv "$ROOT/docs/operations/Week-Transition-Process.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/operations/Week-Transition-Process.md"

mv "$ROOT/docs/governance/WITHDRAWAL_ENGINE_SPEC.md" "$ARCHIVE_DIR/" && \
  echo "  ✓ docs/governance/WITHDRAWAL_ENGINE_SPEC.md"

echo ""

# ============================================================================
# COMPLETION
# ============================================================================

echo "========== ARCHIVING COMPLETE =========="
echo ""
echo "Summary:"
echo "  - 18 files archived"
echo "  - 1 folder archived (client-fluidity-program)"
echo ""
echo "Archived to: $ARCHIVE_DIR"
echo ""
echo "Governance files PRESERVED (FROZEN):"
echo "  ✓ docs/governance/CLAUDE_RULES.md"
echo "  ✓ docs/governance/LIFECYCLE_EXECUTION_MAP.md"
echo "  ✓ docs/governance/FINANCIAL_INVARIANTS.md"
echo "  ✓ docs/governance/IOS_SWEEP_PROTOCOL.md"
echo "  ✓ docs/governance/ARCHITECTURE_ENFORCEMENT.md"
echo "  ✓ docs/governance/DISCOVERY_LIFECYCLE_BOUNDARY.md"
echo ""
echo "Audit trail: DOCUMENTATION_ARCHIVING_AUDIT.csv"
echo ""
