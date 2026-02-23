#!/bin/bash
# VALIDATION 4 Phase 2 — Update Service Protocols to Return Domain Types

# Paths
CUSTOM_CONTEST_PUBLISHING="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/CustomContests/Protocols/CustomContestPublishing.swift"
CUSTOM_CONTEST_CREATING="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/CustomContests/Protocols/CustomContestCreating.swift"
CONTEST_SERVICEING="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Services/ContestServiceing.swift"

echo "Starting VALIDATION 4 Phase 2: Update Service Protocols..."

# 1️⃣ Add 'import Core' to top of each protocol file
for file in "$CUSTOM_CONTEST_PUBLISHING" "$CUSTOM_CONTEST_CREATING" "$CONTEST_SERVICEING"; do
    if ! grep -q "import Core" "$file"; then
        echo "Adding 'import Core' to $file"
        sed -i.bak '1i\
import Core
' "$file"
    fi
done

# 2️⃣ Update return types in CustomContestPublishing
if [ -f "$CUSTOM_CONTEST_PUBLISHING" ]; then
    echo "Updating return type to PublishResult (Domain) in $CUSTOM_CONTEST_PUBLISHING"
    sed -i.bak 's/-> PublishContestResult/-> PublishResult/g' "$CUSTOM_CONTEST_PUBLISHING"
fi

# 3️⃣ Update return type in CustomContestCreating
if [ -f "$CUSTOM_CONTEST_CREATING" ]; then
    echo "Updating return type to Contest (Domain) in $CUSTOM_CONTEST_CREATING"
    sed -i.bak 's/-> ContestDraft/-> Contest/g' "$CUSTOM_CONTEST_CREATING"
fi

# 4️⃣ Update return types in ContestServiceing
if [ -f "$CONTEST_SERVICEING" ]; then
    echo "Updating return types to [Contest] (Domain) in $CONTEST_SERVICEING"
    sed -i.bak 's/-> \[ContestDTO\]/-> [Contest]/g' "$CONTEST_SERVICEING"
fi

echo "Phase 2 complete. Service protocols now reference Domain types only."
echo "Backup copies created with .bak extension in case rollback is needed."
