#!/bin/bash

# Enforce Radius Token Compliance
# Prevents numeric literals in .cornerRadius() calls
# Ensures all corner radius usage comes from DesignTokens.Radius

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAYOFFCHALLENGE="${PROJECT_ROOT}/PlayoffChallenge"

# Search for .cornerRadius( followed by numeric literals
# Exclude DesignTokens.Radius usage
# Exclude intentional 2px micro-radius in LineupView.swift (line 289)
VIOLATIONS=$(grep -R "\.cornerRadius([0-9]" "${PLAYOFFCHALLENGE}" \
  --include="*.swift" 2>/dev/null \
  | grep -v "DesignTokens.Radius" \
  | grep -v "LineupView.swift:289" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: Hardcoded cornerRadius detected. Use DesignTokens.Radius."
  echo ""
  echo "Violations found:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "Radius token enforcement passed."
exit 0
