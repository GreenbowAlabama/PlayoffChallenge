#!/bin/bash
# VALIDATION 4 Phase 1 Setup — Core Domain Migration

# Paths
IOS_DOMAIN_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Domain"
CORE_DOMAIN_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/core/Sources/core/Domain"
BACKUP_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Domain_backup_$(date +%Y%m%d%H%M%S)"

echo "Starting VALIDATION 4 Phase 1: Core Domain Migration..."

# 1 Backup iOS Domain folder
if [ -d "$IOS_DOMAIN_DIR" ]; then
    echo "Backing up existing iOS Domain folder to $BACKUP_DIR"
    mv "$IOS_DOMAIN_DIR" "$BACKUP_DIR"
else
    echo "No iOS Domain folder found, skipping backup."
fi

# 2 Create Core Domain directory
echo "Creating Core Domain folder at $CORE_DOMAIN_DIR"
mkdir -p "$CORE_DOMAIN_DIR"

# 3 List of Domain files to move or create stubs if missing
DOMAIN_FILES=(
    "Contest.swift"
    "ContestActionState.swift"
    "ContestActions.swift"
    "Leaderboard.swift"
    "PublishResult.swift"
    "ContestTemplate.swift"
    "PayoutStructure.swift"
    "CustomContestDraft.swift"
    "CustomContestSettings.swift"
)

# 4 Move files from backup (if available) or create empty stubs
for file in "${DOMAIN_FILES[@]}"; do
    SRC_FILE="$BACKUP_DIR/$file"
    DEST_FILE="$CORE_DOMAIN_DIR/$file"
    if [ -f "$SRC_FILE" ]; then
        echo "Migrating $file to Core Domain"
        mv "$SRC_FILE" "$DEST_FILE"
    else
        echo "$file not found in backup, creating stub in Core"
        touch "$DEST_FILE"
        echo "// TODO: Implement $file Domain type per VALIDATION 4" > "$DEST_FILE"
    fi
done

# 5 Confirm
echo "Phase 1 setup complete. Core Domain folder structure created."
echo "Backup of original iOS Domain folder: $BACKUP_DIR"
echo "Next: Implement Domain types in Core and update imports in ViewModels & Services."
