# Iteration 03 Guardrails

Enforcement system for iOS contract discipline. Seven rules. Four layers. Deterministic.

## The 7 Rules

| # | Invariant | Pattern | Scope |
|---|-----------|---------|-------|
| 1 | No status behavior gating | `contest\.status` | All except legacy |
| 2 | No leaderboard sorting | `\.sorted(\|\.sort(` | Leaderboard files |
| 3 | No rank from enumeration | `enumerated()` + `\+ 1\|rank` | Leaderboard files |
| 4 | Strict required decode | `decodeIfPresent` on required | Models.swift |
| 5 | No silent fallback | `try\? .* ??` (unmatched) | Models.swift |
| 6 | No LeaderboardEntry in custom | `LeaderboardEntry` in custom paths | Leaderboard files |
| 7 | Schema-driven rendering | `row\["` outside DynamicLeaderboardTableView | All files |

## How Enforcement Works

**Layer 1 — CI Grep Gates (Fastest)**
Seven simple patterns. Run in 2 seconds. Ubuntu runner. Fail-fast with explicit whitelist.

**Layer 2 — Strict Decode (Runtime)**
Required contract fields throw on missing. No `decodeIfPresent()`. No `try? ??` fallback.

**Layer 3 — Fixture Tests (Unit)**
Immutable JSON fixtures verify required fields present. Test throws if backend contract changes.

**Layer 4 — PR Checklist (Human)**
Template checklist reminds reviewers. Conscious gate before merge.

## Running Locally

```bash
# Test the script before pushing
./scripts/enforce-iteration-03.sh

# Should print:
# ✓ PASS: All 7 rules
# ════════════════════════════════════════════════════════
# All guardrails passed ✓
```

If any rule fails:
- Fix the code
- Re-run script
- Commit when clean

## CI Behavior

**On every PR touching Swift files:**
- GitHub Actions runs `scripts/enforce-iteration-03.sh` on ubuntu-latest
- All 7 rules checked in parallel
- If any rule fails: PR cannot merge
- Output shows exact violations and line numbers

**No flaky checks.** No false positives (unless you add new rules).

## Updating Rules

**Do not add rules unless a real regression happened.**

If regression occurs:
1. Identify the pattern that slipped through
2. Add grep rule to catch it
3. Update this document
4. Submit in separate PR with evidence of regression

Keep guardrails small and stable. Expansion is debt.

## Key Files

- Script: `/scripts/enforce-iteration-03.sh`
- CI: `.github/workflows/iteration-03-guardrails.yml`
- Fixtures: `/PlayoffChallengeTests/Contracts/ContractDriftTests.swift`
- Reference: `/CLAUDE.md` Iteration 02 & 03

## Why These 7 Rules

1. **Source of truth**: Backend authoritative (actions, state)
2. **No inference**: Rank from data, not position
3. **No sorting**: Preserve backend order
4. **Strict decode**: Fail loudly on contract breach
5. **Schema-driven**: Rendering centralized, extensible
6. **No legacy creep**: Clear boundaries between old/new

## Questions?

See test file: `/PlayoffChallengeTests/ContestDetail/ContestLeaderboardViewModelTests.swift`

That file demonstrates all correct patterns.
