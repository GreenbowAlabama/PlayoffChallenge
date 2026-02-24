## Description

<!-- Brief description of what this PR does -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update

## Testing

<!-- Describe the tests you ran and how to reproduce them -->

## Iteration 03 Contract Compliance ✓

Before requesting review, check:

- [ ] **No contest.status references**
  - Only `contest.displayStatus` used for display
  - Behavior gates use `contractContest.actions` only
  - Verified: `./scripts/enforce-iteration-03.sh`

- [ ] **No leaderboard sorting**
  - Custom contests use backend row order
  - No `.sorted()` or `.sort()` calls
  - Verified: `./scripts/enforce-iteration-03.sh`

- [ ] **No rank inference from enumeration**
  - `enumerated()` not used to compute rank via `index + 1`
  - Verified: `./scripts/enforce-iteration-03.sh`

- [ ] **Contract DTOs use strict decode**
  - Required fields use `decode()` not `decodeIfPresent()`
  - No `try? ?? fallback` on required fields
  - Verified: `./scripts/enforce-iteration-03.sh`

- [ ] **LeaderboardEntry confined to legacy**
  - Custom contests use `LeaderboardResponseContract`
  - `LeaderboardEntry` only in `LeaderboardView.swift`
  - Verified: `./scripts/enforce-iteration-03.sh`

- [ ] **Schema-driven rendering**
  - No hardcoded `row["key"]` access outside `DynamicLeaderboardTableView`
  - Verified: `./scripts/enforce-iteration-03.sh`

---

**CI Enforcement:** All checks above automatically fail the build if violated.
**Reference:** `/CLAUDE.md` Iteration 02 & 03
**Questions?** See `/docs/iteration-03-guardrails.md`
