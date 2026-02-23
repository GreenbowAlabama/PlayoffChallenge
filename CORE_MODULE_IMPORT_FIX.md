# iOS Core Module Import Fix — Status & Solutions

**Issue**: iOS app can't find `import Core` during xcodebuild compilation
**Root Cause**: Xcode module resolution between local Swift package (Core) and Xcode project (PlayoffChallenge) not working properly
**Severity**: 🔴 BLOCKING — prevents iOS integration tests

---

## Problem Analysis

### What We've Done
1. ✅ Core package builds successfully (`swift build`)
2. ✅ iOS Xcode project has local package reference to Core (`../../core`)
3. ✅ Fixed stale Domain file references in Xcode project
4. ✅ Fixed import order (moved `import Core` after Foundation imports)
5. ✅ Core builds for iOS Simulator (tested with explicit destination)
6. ❌ PlayoffChallenge can't find Core module at compile time

### What's Failing
```
error: Unable to find module dependency: 'Core'
```

This error occurs in ALL files that do `import Core`:
- ViewModels/*.swift
- Services/*.swift
- Models/Models.swift
- CustomContests/**/*.swift

### Why It's Happening
Xcode's implicit module building for local Swift packages isn't resolving the Core module properly during compilation. The issue is NOT:
- Missing Core package dependency (it's configured)
- Core package not building (it builds fine)
- Link phase issues (this is a compile-time error)

---

## Solutions to Try

### Solution 1: Open in Xcode IDE (RECOMMENDED FOR TESTING)
```bash
open PlayoffChallenge.xcodeproj
# Then build from Xcode GUI
# Xcode IDE handles package resolution better than CLI
```

**Why**: Xcode's IDE has better module caching and resolution than xcodebuild CLI
**Risk**: Low (native Xcode workflow)
**Expected Outcome**: iOS app likely builds in IDE; may still fail in CI/CD

---

### Solution 2: Create an Explicit Module Map (WORKAROUND)
Create `core/module.modulemap`:
```
module Core {
    umbrella header "Core-module.h"
    export *
}
```

**Risk**: May conflict with Swift package module declaration
**Effort**: Medium

---

### Solution 3: Disable Explicit Module Build (QUICK FIX)
In `PlayoffChallenge.xcodeproj/project.pbxproj`, find:
```
ENABLE_EXPLICIT_MODULE_BUILD = YES;
```

Change to:
```
ENABLE_EXPLICIT_MODULE_BUILD = NO;
```

Then rebuild:
```bash
xcodebuild build -scheme PlayoffChallenge -configuration Debug \
  -destination 'generic/platform=iOS Simulator'
```

**Why**: Explicit module build is strict about module resolution; implicit may be more lenient
**Risk**: Medium (disables beneficial compiler feature)
**Expected Outcome**: Module resolution may work with implicit modules

---

### Solution 4: Use Xcode 16+ Package Resolution (BEST LONG-TERM)
Ensure `core/Package.swift` has explicit iOS platform support:

```swift
let package = Package(
    name: "core",
    platforms: [
        .iOS(.v13)  // ← MUST HAVE
    ],
    // ...
)
```

✅ **Already configured in our Package.swift**

Then in `PlayoffChallenge.xcodeproj`, ensure the Core dependency is properly declared.

---

### Solution 5: Restructure as CocoaPods/SPM Hybrid
Use CocoaPods for iOS app, SPM for Core package. (Advanced, not recommended for this stage)

---

## Immediate Recommendations

### For Phase 8-11 Execution

**Option A: Skip xcodebuild for now (PRAGMATIC)**
1. Document that iOS must be built from Xcode IDE
2. Add to CI/CD:
   - Core: `swift build && swift test` ✅ (works)
   - iOS: Manual Xcode build or use `xcodebuild` with `Solution 3` applied
3. Phase 10 can add proper CI/CD once Core module resolution is fixed

**Option B: Apply Solution 3 (QUICK FIX)**
1. Disable explicit module build in project
2. Test `xcodebuild build` again
3. If it works, proceed with Phase 8-11
4. Schedule deeper investigation for Phase 11

**Option C: Wait for Xcode Patch (CONSERVATIVE)**
- This may be a known Xcode 16.2 issue with SPM local packages
- Check Xcode 16.3+ release notes

---

## Workaround for Immediate Testing

Until this is fixed, you can:

1. **Comment out Core imports** in files and stub the types locally:
```swift
// import Core  // TODO: Fix module resolution

// Stub types for now
typealias Contest = MockContest
typealias ContestActionState = MockContestActionState
// ...
```

2. **Run domain tests in Core package only**:
```bash
cd core && swift test
```

3. **Test iOS app with Xcode IDE** instead of CLI.

---

## Action Items

### For Core Dev (Phase 8)
- [ ] Proceed with Domain type definitions (Swift build works fine)
- [ ] Phase 8 tests will run via `swift test` (no xcodebuild needed)
- [ ] No blocker for Core Dev work

### For iOS Dev (Phase 9)
- [ ] Document: iOS builds must use Xcode IDE for now
- [ ] Try Solution 3 (disable explicit module build)
- [ ] If still blocked, use stub approach above temporarily
- [ ] Plan proper fix for Phase 11 CI/CD setup

### For DevOps/QA (Phase 10)
- [ ] Investigate Xcode SPM local package module resolution
- [ ] Consider xcodebuild alternatives (bazel, fastlane, direct xcodebuild plugins)
- [ ] Set up Xcode bot or GitHub Actions workaround for iOS builds

---

## Next Steps

**TODAY**: Pick one of Solutions 1, 3, or A above and test
**AFTER DECISION**: Proceed with Phase 8-11 execution
**PHASE 11**: Schedule deep investigation + fix for production CI/CD

---

**Document**: CORE_MODULE_IMPORT_FIX.md
**Priority**: MEDIUM (blocking iOS xcodebuild, not blocking Swift tests)
**Owner**: DevOps/QA
**ETA Fix**: Phase 11 or before depending on solution chosen

