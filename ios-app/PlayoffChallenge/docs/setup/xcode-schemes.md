# Xcode Schemes – Locked for Client Lock v1

This project uses the following valid schemes:

## App Build
PlayoffChallenge

Build command:
xcodebuild -scheme PlayoffChallenge -destination 'platform=iOS Simulator,name=iPhone 17' build

## Unit Tests
PlayoffChallengeUnitTests

Test command:
xcodebuild -scheme PlayoffChallengeUnitTests -destination 'platform=iOS Simulator,name=iPhone 17' test

## Core Package Tests
core

Test command:
xcodebuild -scheme core -destination 'platform=iOS Simulator,name=iPhone 17' test

---

DO NOT use:
- PlayoffChallengeTests (does not exist)
- iPhone 15 simulator (not configured)

Standard simulator for this repository:
iPhone 17
