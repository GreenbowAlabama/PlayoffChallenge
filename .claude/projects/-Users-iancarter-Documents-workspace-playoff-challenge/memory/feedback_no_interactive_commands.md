---
name: No interactive or probing commands
description: Never run interactive CLI commands (xcrun simctl list, etc.) or broad repo scanning. Stay deterministic and non-blocking.
type: feedback
---

Do not run interactive commands or broad scanning commands when building/testing iOS.

**Why:** User wants deterministic, non-blocking execution. Probing simulators, scanning repos, and interactive commands waste time and block progress.

**How to apply:**
- Use `generic/platform=iOS Simulator` for xcodebuild destination (no need to discover specific devices)
- Use exact xcodebuild commands provided by user
- Never run `xcrun simctl list`, `find` across whole repo, or other exploratory commands
- If build fails, read the error output — don't probe the environment
