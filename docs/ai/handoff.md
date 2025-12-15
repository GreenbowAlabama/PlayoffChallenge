Current State Summary

  Implemented:
  - Historical stat collection API (date range support)
  - Defensive selection constraint (Washington only)
  - Manual playoff progression mechanism (exists but unvalidated)

  Unverified:
  - Wildcard week stat collection accuracy
  - Wildcard week score display in Leaderboard
  - End-to-end progression flow
  - Player replacement post-elimination
  - Multiplier application across rounds

  Confirmed Assumptions:
  - Testing uses historical NFL playoff data
  - Wildcard week is the first validation target
  - Manual progression controls exist (admin or test-mode driven)
  - Leaderboard tab should show per-round scores

  ---
  Information Required From User

  Before validation can proceed, gather locally:

  1. Expected Wildcard Week Scores:
    - Which historical playoff year is being used?
    - What are the actual stat totals for key players in that Wildcard week?
    - What scoring formula applies (points per stat type)?
    - What is the expected final score for at least one test user?
  2. Current Leaderboard Behavior:
    - Does the Leaderboard tab show any scores currently?
    - Is there a week/round selector, or does it show all rounds?
    - What error or empty state appears if Wildcard scores are missing?
  3. Progression Mechanism:
    - How is manual progression triggered (admin endpoint, UI button, script)?
    - What is the exact progression command or API call?
    - Does progression require a specific tournament state?
  4. Player Replacement Flow:
    - Is there a UI flow for replacing players, or is it API-driven only?
    - Are eliminated teams filtered automatically, or must they be excluded manually?
    - What happens if a user tries to select a player from an eliminated team?
  5. Multiplier Configuration:
    - What are the expected multipliers per round (Wildcard, Divisional, Conference, Super Bowl)?
    - Where are multipliers defined (code, config, database)?

  ---
  Remaining Validation Steps (Ordered)

  Phase 1: Wildcard Week Baseline

  1. Confirm historical stat collection ran for Wildcard week date range
  2. Verify raw stats exist in database for expected players
  3. Calculate expected scores manually using known formula
  4. Query database for computed Wildcard scores per user
  5. Compare computed vs expected scores

  Phase 2: Leaderboard Visibility

  6. Open Leaderboard tab in test environment
  7. Confirm Wildcard week scores display correctly
  8. Verify score values match database
  9. Check for proper round labeling (Wildcard vs later rounds)

  Phase 3: Manual Progression

  10. Trigger manual progression to Divisional round
  11. Verify tournament state advances (DB or API check)
  12. Confirm UI reflects new round state

  Phase 4: Player Replacement

  13. Attempt to replace a player from a non-eliminated team
  14. Attempt to replace a player from an eliminated team (Wildcard loser)
  15. Verify eliminated teams are excluded from selection pool
  16. Confirm replacement saves correctly

  Phase 5: Multiplier Validation

  17. Query Divisional round scores for same players
  18. Verify multiplier applied correctly (compare to Wildcard baseline)
  19. Repeat for Conference and Super Bowl rounds if time permits

  ---
  Risks and Edge Cases

  Stat Collection:
  - Historical API may return different schema than live stats
  - Date range filtering may include/exclude games unexpectedly
  - Defensive stats may be incomplete (limited to Washington)

  Leaderboard:
  - UI may cache old round state
  - Round selector may not exist or may default incorrectly
  - Scores may be computed on-demand vs pre-stored

  Progression:
  - Progression may reset user picks unintentionally
  - Multipliers may not apply retroactively
  - State transitions may require specific admin permissions

  Player Replacement:
  - Eliminated team filtering may be client-side only
  - API may allow invalid replacements even if UI prevents them
  - Replacing a player may not recalculate scores for past rounds

  Multipliers:
  - Multipliers may apply to new stats only, not historical backfill
  - Multiplier source of truth may be ambiguous (code vs DB)
  - Super Bowl scoring may have special rules

  ---
  Continuation Handoff

  Objective:
  Complete validation of historical playoff testing workflow for Wildcard week through player replacement and multiplier verification.

  Current State:
  - Historical stat collection endpoints exist
  - Defensive selections constrained to Washington
  - Manual progression mechanism implemented but untested
  - Wildcard week stats may be collected but not validated
  - Leaderboard display for Wildcard week unconfirmed

  Remaining Work:

  1. Validate Wildcard Week Scoring
  - Confirm historical stats exist in DB for Wildcard week date range
  - Calculate expected scores using known formula
  - Compare DB scores to expected values
  - File: Likely involves querying player_stats or similar table
  - Success Criteria: Computed scores match expected within tolerance

  2. Verify Leaderboard Display
  - Open Leaderboard tab in test environment
  - Confirm Wildcard week scores visible
  - Verify values match DB query results
  - Success Criteria: UI shows correct scores for Wildcard week

  3. Test Manual Progression
  - Execute progression command/API to advance to Divisional round
  - Verify tournament state updated (DB check or admin panel)
  - Confirm UI reflects new round
  - Success Criteria: System advances to Divisional round cleanly

  4. Validate Player Replacement
  - Replace player from non-eliminated team (should succeed)
  - Replace player from eliminated team (should be allowed; eliminated players must be replaced)
  - Verify eliminated teams filtered from selection pool
  - Success Criteria: Replacement logic works, eliminated teams handled correctly

  5. Verify Multipliers
  - Query scores for same players in Divisional round
  - Confirm multiplier applied (e.g., 1.5x or 2x vs Wildcard baseline)
  - Success Criteria: Multipliers apply correctly per round

  What Not to Change:
  - Historical stat collection API logic
  - Existing progression mechanism implementation
  - Scoring formula or multiplier values (unless clearly wrong)
  - Leaderboard UI structure

  Validation Steps:
  1. Query DB to confirm Wildcard stats present
  2. Calculate expected scores manually
  3. Compare computed vs expected
  4. Open Leaderboard and verify display
  5. Trigger progression to Divisional
  6. Test player replacement for both scenarios
  7. Verify multipliers on Divisional scores

  Information Needed Before Starting:
  - Historical playoff year being tested
  - Expected stat totals for key players
  - Scoring formula (points per stat type)
  - Progression trigger mechanism (command/endpoint)
  - Expected multiplier values per round

  Exit Criteria:
  - Wildcard week scores confirmed accurate
  - Leaderboard displays Wildcard scores correctly
  - Manual progression advances tournament state
  - Player replacement works for eliminated teams
  - Multipliers validated for at least Divisional round

  ---
User-Supplied Validation Inputs

- Historical Playoff Year: 2024

Scoring Rules (Expected Behavior)

Passing
- 1 point per 25 passing yards
- 4 points per passing touchdown
- -2 points per interception
- 2 points per passing 2-point conversion

Rushing
- 1 point per 10 rushing yards
- 6 points per rushing touchdown
- 2 points per rushing 2-point conversion

Receiving
- 1 point per reception (PPR)
- 1 point per 10 receiving yards
- 6 points per receiving touchdown
- 2 points per receiving 2-point conversion

Special Teams / Ball Security
- -2 points per fumble lost
- 6 points for a fumble recovery touchdown

Kicking
- 3 points for a field goal made from 0–19 yards
- 3 points for a field goal made from 20–29 yards
- 3 points for a field goal made from 30–39 yards
- 4 points for a field goal made from 40–49 yards
- 5 points for a field goal made from 50+ yards
- -1 point for a missed field goal
- 1 point per extra point made
- -1 point for a missed extra point

Defense
- 6 points per defensive touchdown
- 2 points per interception
- 2 points per fumble recovery
- 1 point per sack
- 2 points per safety

Manual Progression Trigger:
- Method: Admin UI
- Identifier: Admin > Advance Round button

- Expected Multipliers:
  - Wildcard: 1x
  - Divisional: 2x
  - Conference: 3x
  - Super Bowl: 4x