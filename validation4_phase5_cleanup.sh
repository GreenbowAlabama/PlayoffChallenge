#!/bin/bash
# VALIDATION 4 Phase 5 — Clean Up iOS App Domain & Update Imports

# Paths
IOS_DOMAIN_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Domain"
MODELS_FILE="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Models/Models.swift"

echo "Starting VALIDATION 4 Phase 5: iOS App Cleanup..."

# 1️⃣ Delete old iOS Domain folder if it exists
if [ -d "$IOS_DOMAIN_DIR" ]; then
    echo "Deleting old iOS Domain folder at $IOS_DOMAIN_DIR"
    rm -rf "$IOS_DOMAIN_DIR"
else
    echo "No iOS Domain folder found, skipping deletion."
fi

# 2️⃣ Update Models.swift imports to Core Domain
if [ -f "$MODELS_FILE" ]; then
    echo "Updating Models.swift to import Core Domain types"
    
    # Remove any existing local Domain imports
    sed -i.bak '/import .*Domain/d' "$MODELS_FILE"
    
    # Add Core import at top if missing
    if ! grep -q "import Core" "$MODELS_FILE"; then
        sed -i.bak '1i\
import Core
' "$MODELS_FILE"
    fi
    
    # Optional: re-export Domain types if needed
    sed -i.bak '/@_exported import struct Core/d' "$MODELS_FILE"
    cat << 'EOM' >> "$MODELS_FILE"

@_exported import struct Core.Contest
@_exported import struct Core.ContestStatus
@_exported import struct Core.ContestActionState
@_exported import struct Core.ContestActions
@_exported import struct Core.Leaderboard
@_exported import struct Core.LeaderboardColumn
@_exported import struct Core.LeaderboardRow
@_exported import struct Core.LeaderboardState
@_exported import struct Core.PayoutTier
@_exported import struct Core.PublishResult
@_exported import struct Core.ContestTemplate
@_exported import struct Core.PayoutStructure
@_exported import struct Core.CustomContestSettings
@_exported import struct Core.CustomContestDraft
EOM
fi

echo "Phase 5 complete. iOS app Domain cleaned up and Models.swift updated."
echo "Backup of original Models.swift saved with .bak extension."
