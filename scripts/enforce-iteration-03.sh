#!/bin/bash
# Iteration 03 Guardrails Enforcement
# Fail-fast approach: simple grep patterns, explicit whitelisting.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCES_DIR="$REPO_ROOT/ios-app/PlayoffChallenge"
EXIT_CODE=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "════════════════════════════════════════════════════════"
echo "Iteration 03 — Hardening Guardrails Enforcement"
echo "════════════════════════════════════════════════════════"

# RULE 1: No contest.status references outside legacy files
echo ""
echo "Rule 1: Checking for contest.status usage..."
VIOLATIONS=$(grep -r "contest\.status" \
    "$SOURCES_DIR" \
    --include="*.swift" \
    --exclude="Views/LeaderboardView.swift" \
    --exclude="Views/AvailableContestsView.swift" \
    --exclude-dir=PlayoffChallengeTests 2>/dev/null | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: contest.status found outside legacy files"
    echo "Found $VIOLATIONS occurrence(s):"
    grep -r "contest\.status" "$SOURCES_DIR" \
        --include="*.swift" \
        --exclude="Views/LeaderboardView.swift" \
        --exclude="Views/AvailableContestsView.swift" \
        --exclude-dir=PlayoffChallengeTests 2>/dev/null || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No contest.status references"
fi

# RULE 2: No sorting in custom contest leaderboard files
echo ""
echo "Rule 2: Checking for sorting in leaderboard files..."
VIOLATIONS=$(grep -r "\.sorted(\|\.sort(" \
    "$SOURCES_DIR" \
    --include="*ContestLeaderboard*.swift" \
    --include="*DynamicLeaderboard*.swift" \
    --exclude-dir=PlayoffChallengeTests 2>/dev/null | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: Sorting detected in leaderboard files"
    echo "Found $VIOLATIONS occurrence(s):"
    grep -r "\.sorted(\|\.sort(" \
        "$SOURCES_DIR" \
        --include="*ContestLeaderboard*.swift" \
        --include="*DynamicLeaderboard*.swift" \
        --exclude-dir=PlayoffChallengeTests 2>/dev/null || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No sorting in leaderboard files"
fi

# RULE 3: enumerated() only fails if combined with rank inference
echo ""
echo "Rule 3: Checking for rank inference from enumeration..."
VIOLATIONS=$(grep -r "enumerated()" \
    "$SOURCES_DIR" \
    --include="*ContestLeaderboard*.swift" \
    --include="*DynamicLeaderboard*.swift" \
    -n \
    --exclude-dir=PlayoffChallengeTests 2>/dev/null \
    | grep -E "\+ 1|rank" | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: Rank inference from enumeration detected"
    echo "Found $VIOLATIONS occurrence(s):"
    grep -r "enumerated()" \
        "$SOURCES_DIR" \
        --include="*ContestLeaderboard*.swift" \
        --include="*DynamicLeaderboard*.swift" \
        -n \
        --exclude-dir=PlayoffChallengeTests 2>/dev/null \
        | grep -E "\+ 1|rank" || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No rank inference from enumeration"
fi

# RULE 4: No decodeIfPresent on required contract fields (ContestDetailResponseContract and LeaderboardResponseContract)
echo ""
echo "Rule 4: Checking for decodeIfPresent on required fields..."
VIOLATIONS=$(grep -n "decodeIfPresent.*forKey: \.\(contest_id\|leaderboard_state\|actions\|payout_table\|roster_config\|column_schema\|rows\)" \
    "$SOURCES_DIR/Models/Models.swift" 2>/dev/null | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: decodeIfPresent on required contract fields"
    grep -n "decodeIfPresent.*forKey: \.\(contest_id\|leaderboard_state\|actions\|payout_table\|roster_config\|column_schema\|rows\)" \
        "$SOURCES_DIR/Models/Models.swift" 2>/dev/null || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No decodeIfPresent on required fields"
fi

# RULE 5: No try? ?? fallback on required contract fields
echo ""
echo "Rule 5: Checking for try? ?? fallback..."
VIOLATIONS=$(grep -n "try\? .* ??" \
    "$SOURCES_DIR/Models/Models.swift" 2>/dev/null \
    | grep -v "String.*decode.*Double\|Double.*decode.*String" | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: Undocumented try? ?? fallback in contracts"
    grep -n "try\? .* ??" "$SOURCES_DIR/Models/Models.swift" 2>/dev/null \
        | grep -v "String.*decode.*Double\|Double.*decode.*String" || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No undocumented fallbacks"
fi

# RULE 6: No LeaderboardEntry (actual type, not Mock) in custom contest files
echo ""
echo "Rule 6: Checking for LeaderboardEntry in custom contests..."
VIOLATIONS=$(grep -r "LeaderboardEntry" \
    "$SOURCES_DIR" \
    --include="*ContestLeaderboard*.swift" \
    --include="*DynamicLeaderboard*.swift" \
    --exclude-dir=PlayoffChallengeTests 2>/dev/null \
    | grep -v "MockLeaderboardEntry\|struct.*Entry.*Identifiable" | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: LeaderboardEntry found in custom contest files"
    echo "Found $VIOLATIONS occurrence(s):"
    grep -r "LeaderboardEntry" \
        "$SOURCES_DIR" \
        --include="*ContestLeaderboard*.swift" \
        --include="*DynamicLeaderboard*.swift" \
        --exclude-dir=PlayoffChallengeTests 2>/dev/null \
        | grep -v "MockLeaderboardEntry\|struct.*Entry.*Identifiable" || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: No LeaderboardEntry in custom contests"
fi

# RULE 7: No hardcoded column key access outside DynamicLeaderboardTableView
echo ""
echo "Rule 7: Checking for hardcoded leaderboard column keys..."
VIOLATIONS=$(grep -r 'row\["' \
    "$SOURCES_DIR" \
    --include="*.swift" \
    --exclude-dir=PlayoffChallengeTests \
    --exclude="Views/DynamicLeaderboardTableView.swift" 2>/dev/null \
    | grep -v "CustomContests/Models\|test" | wc -l)

if [ "$VIOLATIONS" -gt 0 ]; then
    echo -e "${RED}✗ FAIL${NC}: Hardcoded column keys found outside DynamicLeaderboardTableView"
    echo "Found $VIOLATIONS occurrence(s):"
    grep -r 'row\["' \
        "$SOURCES_DIR" \
        --include="*.swift" \
        --exclude-dir=PlayoffChallengeTests \
        --exclude="Views/DynamicLeaderboardTableView.swift" 2>/dev/null \
        | grep -v "CustomContests/Models\|test" || true
    EXIT_CODE=1
else
    echo -e "${GREEN}✓ PASS${NC}: Schema-driven rendering enforced"
fi

echo ""
echo "════════════════════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All guardrails passed ✓${NC}"
else
    echo -e "${RED}Guardrails enforcement failed ✗${NC}"
fi
echo "════════════════════════════════════════════════════════"

exit $EXIT_CODE
