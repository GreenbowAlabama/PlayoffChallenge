#!/bin/bash

echo "-----------------------------------------"
echo "CLAUDE GOVERNANCE LAUNCHER"
echo "-----------------------------------------"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
DIRTY=$(git status --porcelain)

echo "Current branch: $BRANCH"

if [ ! -z "$DIRTY" ]; then
  echo "ERROR: Working tree not clean."
  echo "Commit or stash changes before proceeding."
  exit 1
fi

if [ "$BRANCH" != "staging" ] && [ "$BRANCH" != "main" ]; then
  echo "WARNING: Non-protected branch detected."
  echo "Confirm intentional feature development."
fi

echo ""
echo "SYSTEM STATE:"
echo "Lifecycle Engine: FROZEN (v1)"
echo "Settlement: Automatic + Snapshot-Bound"
echo "Wallet Join Atomicity: FROZEN"
echo "Discovery Cascade Ordering: FROZEN"
echo "Withdrawal Engine: DESIGN ONLY (Feature Flag Required)"
echo ""

echo "MANDATORY GOVERNANCE PRE-READ:"
echo "- docs/governance/CLAUDE_RULES.md"
echo "- docs/governance/LIFECYCLE_EXECUTION_MAP.md"
echo "- docs/governance/FINANCIAL_INVARIANTS.md"
echo "- docs/governance/IOS_SWEEP_PROTOCOL.md"
echo ""

echo "Launching Claude..."
echo "-----------------------------------------"

claude
