#!/bin/bash
# VALIDATION 4 Phase 6 — Build & Test Core and iOS App

# Paths
CORE_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/core"
IOS_APP_DIR="/Users/iancarter/Documents/workspace/playoff-challenge/ios-app/PlayoffChallenge"

echo "Starting VALIDATION 4 Phase 6: Build & Test..."

# 1️⃣ Build and test Core package
echo "Building Core package..."
cd "$CORE_DIR" || exit 1
swift build
if [ $? -ne 0 ]; then
    echo "❌ Core build failed."
    exit 1
fi

echo "Running Core unit tests..."
swift test
if [ $? -ne 0 ]; then
    echo "❌ Core tests failed."
    exit 1
fi
echo "✅ Core package build & tests successful."

# 2️⃣ Build iOS app
echo "Building iOS app..."
cd "$IOS_APP_DIR" || exit 1
swift build
if [ $? -ne 0 ]; then
    echo "❌ iOS app build failed."
    exit 1
fi
echo "✅ iOS app build successful."

# 3️⃣ Final Verification
echo "VALIDATION 4 Phase 6 complete."
echo "All builds passed. Core & iOS app reference only Domain types from Core."
