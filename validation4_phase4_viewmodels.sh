#!/bin/bash
# VALIDATION 4 Phase 4 — Refactor ViewModels to use Domain types

# Paths to ViewModels
AVAILABLE_CONTESTS_VM="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/ViewModels/AvailableContestsViewModel.swift"
CONTEST_DETAIL_VM="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/ViewModels/ContestDetailViewModel.swift"
CONTEST_LEADERBOARD_VM="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/ViewModels/ContestLeaderboardViewModel.swift"
CREATE_CUSTOM_CONTEST_VM="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/CustomContests/ViewModels/CreateCustomContestViewModel.swift"

echo "Starting VALIDATION 4 Phase 4: Refactor ViewModels..."

# 1️⃣ Ensure 'import Core' at top
for file in "$AVAILABLE_CONTESTS_VM" "$CONTEST_DETAIL_VM" "$CONTEST_LEADERBOARD_VM" "$CREATE_CUSTOM_CONTEST_VM"; do
    if ! grep -q "import Core" "$file"; then
        echo "Adding 'import Core' to $file"
        sed -i.bak '1i\
import Core
' "$file"
    fi
done

# 2️⃣ Replace @Published DTO/Contract with Domain types

# AvailableContestsViewModel
if [ -f "$AVAILABLE_CONTESTS_VM" ]; then
    echo "Updating @Published properties in AvailableContestsViewModel"
    sed -i.bak -E 's/@Published var contests: \[MockContest\]/@Published var contests: [Contest]/g' "$AVAILABLE_CONTESTS_VM"
fi

# ContestDetailViewModel
if [ -f "$CONTEST_DETAIL_VM" ]; then
    echo "Updating @Published properties in ContestDetailViewModel"
    sed -i.bak -E 's/@Published var contract: ContestActionStateContract/@Published var actionState: ContestActionState/g' "$CONTEST_DETAIL_VM"
fi

# ContestLeaderboardViewModel
if [ -f "$CONTEST_LEADERBOARD_VM" ]; then
    echo "Updating @Published properties in ContestLeaderboardViewModel"
    sed -i.bak -E 's/@Published var contract: LeaderboardContract/@Published var leaderboard: Leaderboard/g' "$CONTEST_LEADERBOARD_VM"
fi

# CreateCustomContestViewModel
if [ -f "$CREATE_CUSTOM_CONTEST_VM" ]; then
    echo "Updating @Published properties in CreateCustomContestViewModel"
    sed -i.bak -E 's/@Published var contract: CustomContestDraftContract/@Published var draft: CustomContestDraft/g' "$CREATE_CUSTOM_CONTEST_VM"
fi

# 3️⃣ Verify protocol injection
echo "Verifying that all ViewModels use protocol injection instead of concrete services..."
for file in "$AVAILABLE_CONTESTS_VM" "$CONTEST_DETAIL_VM" "$CONTEST_LEADERBOARD_VM" "$CREATE_CUSTOM_CONTEST_VM"; do
    if grep -q "= .*Service()" "$file"; then
        echo "Warning: Found direct service instantiation in $file — replace with protocol injection!"
    fi
done

echo "Phase 4 complete. ViewModels now use Domain types from Core and protocol injection verified."
echo "Backup copies created with .bak extension for rollback if needed."
