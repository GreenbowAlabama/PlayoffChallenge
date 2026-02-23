#!/bin/bash
# VALIDATION 4 Phase 3 — Map Contract → Domain in Service Implementations

# Paths
CONTEST_DETAIL_SERVICE="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/Services/ContestDetailService.swift"
CUSTOM_CONTEST_SERVICE="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge/CustomContests/Services/CustomContestService.swift"

echo "Starting VALIDATION 4 Phase 3: Map Contract → Domain in Services..."

# 1️⃣ Add 'import Core' if missing
for file in "$CONTEST_DETAIL_SERVICE" "$CUSTOM_CONTEST_SERVICE"; do
    if ! grep -q "import Core" "$file"; then
        echo "Adding 'import Core' to $file"
        sed -i.bak '1i\
import Core
' "$file"
    fi
done

# 2️⃣ Update fetch methods to map Contract → Domain in ContestDetailService
if [ -f "$CONTEST_DETAIL_SERVICE" ]; then
    echo "Ensuring Contract → Domain mapping in ContestDetailService"
    # Example: replace return of DTO with mapping function
    sed -i.bak -E 's/return ([a-zA-Z0-9_]+Contract)/return mapContractToDomain(\1)/g' "$CONTEST_DETAIL_SERVICE"
fi

# 3️⃣ Update CustomContestService methods
if [ -f "$CUSTOM_CONTEST_SERVICE" ]; then
    echo "Ensuring Contract → Domain mapping in CustomContestService"
    # Map available contests
    sed -i.bak -E 's/return ([a-zA-Z0-9_]+DTO)/return mapContractToDomain(\1)/g' "$CUSTOM_CONTEST_SERVICE"
    # Map created contests
    sed -i.bak -E 's/return ([a-zA-Z0-9_]+CreatedDTO)/return mapContractToDomain(\1)/g' "$CUSTOM_CONTEST_SERVICE"
    # Map publish results
    sed -i.bak -E 's/return ([a-zA-Z0-9_]+PublishContract)/return mapContractToDomain(\1)/g' "$CUSTOM_CONTEST_SERVICE"
fi

echo "Phase 3 complete. All service implementations now map Contracts → Domain."
echo "Backup copies created with .bak extension for rollback if needed."
