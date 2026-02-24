--
-- Database Wipe Script - Phase 0
-- Purpose: Clear all test user data for fresh compliance testing
-- Date: 2025-12-12
--
-- WHAT THIS WIPES:
--   - All users (test accounts)
--   - All picks
--   - All scores
--   - All player_swaps
--   - All pick_multipliers
--
-- WHAT THIS PRESERVES:
--   - players table (NFL roster data)
--   - position_requirements
--   - scoring_rules
--   - game_settings (structure, but resets state)
--   - payout_structure
--   - rules_content
--

BEGIN;

-- Show counts BEFORE deletion
SELECT 'BEFORE DELETION:' AS status;
SELECT COUNT(*) AS user_count FROM users;
SELECT COUNT(*) AS pick_count FROM picks;
SELECT COUNT(*) AS score_count FROM scores;
SELECT COUNT(*) AS swap_count FROM player_swaps;
SELECT COUNT(*) AS multiplier_count FROM pick_multipliers;

-- Clear all user-generated data (CASCADE will handle foreign keys)
DELETE FROM pick_multipliers;
DELETE FROM player_swaps;
DELETE FROM scores;
DELETE FROM picks;
DELETE FROM users;

-- Reset game state to pre-season
UPDATE game_settings
SET current_playoff_week = 0,
    is_week_active = false;

-- Show counts AFTER deletion
SELECT 'AFTER DELETION:' AS status;
SELECT COUNT(*) AS user_count FROM users;
SELECT COUNT(*) AS pick_count FROM picks;
SELECT COUNT(*) AS score_count FROM scores;
SELECT COUNT(*) AS swap_count FROM player_swaps;
SELECT COUNT(*) AS multiplier_count FROM pick_multipliers;

-- Show what was preserved
SELECT 'PRESERVED DATA:' AS status;
SELECT COUNT(*) AS player_count FROM players;
SELECT COUNT(*) AS position_req_count FROM position_requirements;
SELECT COUNT(*) AS scoring_rule_count FROM scoring_rules;
SELECT COUNT(*) AS payout_count FROM payout_structure;

COMMIT;

SELECT '✅ Database wipe completed successfully' AS final_status;
