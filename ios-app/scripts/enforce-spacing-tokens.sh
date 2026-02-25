#!/bin/bash

# Enforce Spacing & Padding Token Compliance
# Prevents numeric literals in spacing and padding calls
# Ensures all spacing/padding usage comes from DesignTokens.Spacing

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAYOFFCHALLENGE="${PROJECT_ROOT}/PlayoffChallenge"

# Mapped token values that must NOT appear as literals (must use DesignTokens.Spacing)
# These are the standardized spacing tokens: xxs(4), xs(6), sm(8), md(12), lg(16), xl(20), xxl(24)
MAPPED_VALUES="4|6|8|12|16|20|24"

# Exception values that are documented and allowed (context-specific spacing)
# spacing: 0 = stacked layout
# spacing: 2 = tightly grouped items
# spacing: 3 = custom interior spacing
# spacing: 10,15,30 = non-standard context-specific values

echo "Checking for hardcoded spacing values..."

# Check for hardcoded spacing: N (where N is a mapped token value)
SPACING_VIOLATIONS=$(grep -R "spacing: \($MAPPED_VALUES\)" "${PLAYOFFCHALLENGE}" \
  --include="*.swift" 2>/dev/null \
  | grep -v "DesignTokens.Spacing" \
  || true)

# Check for hardcoded .padding(N) with mapped values
PADDING_VIOLATIONS=$(grep -R "\.padding($MAPPED_VALUES)" "${PLAYOFFCHALLENGE}" \
  --include="*.swift" 2>/dev/null \
  | grep -v "DesignTokens.Spacing" \
  || true)

# Check for .padding(.horizontal|.vertical|.top|.bottom|.leading|.trailing, N)
DIRECTIONAL_VIOLATIONS=$(grep -R "\.padding(\.\(horizontal\|vertical\|top\|bottom\|leading\|trailing\), $MAPPED_VALUES)" "${PLAYOFFCHALLENGE}" \
  --include="*.swift" 2>/dev/null \
  | grep -v "DesignTokens.Spacing" \
  || true)

# Combine all violations, filter out empty lines
ALL_VIOLATIONS=$(echo -e "$SPACING_VIOLATIONS\n$PADDING_VIOLATIONS\n$DIRECTIONAL_VIOLATIONS" | grep -v "^$" | sort | uniq || true)

if [ -n "$ALL_VIOLATIONS" ]; then
  echo "ERROR: Hardcoded spacing values detected. Use DesignTokens.Spacing."
  echo ""
  echo "Mapped values (4,6,8,12,16,20,24) must use design tokens:"
  echo "  spacing: 4 → DesignTokens.Spacing.xxs"
  echo "  spacing: 6 → DesignTokens.Spacing.xs"
  echo "  spacing: 8 → DesignTokens.Spacing.sm"
  echo "  spacing: 12 → DesignTokens.Spacing.md"
  echo "  spacing: 16 → DesignTokens.Spacing.lg"
  echo "  spacing: 20 → DesignTokens.Spacing.xl"
  echo "  spacing: 24 → DesignTokens.Spacing.xxl"
  echo ""
  echo "Exception values (0,2,3,10,15,30) are allowed for context-specific spacing."
  echo ""
  echo "Violations found:"
  echo "$ALL_VIOLATIONS"
  exit 1
fi

echo "✓ Spacing token enforcement passed."
exit 0
