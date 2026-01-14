-- Backfill player_swaps for week 20 (Divisional round)
-- This script detects swaps by comparing picks from week 19 to week 20
-- A swap is detected when:
--   1. User had a player at position P in week 19
--   2. User has a DIFFERENT player at position P in week 20
--   3. The week 19 player is NOT in week 20 picks (was replaced, not just added alongside)
--
-- Safe to run multiple times: uses INSERT ... ON CONFLICT DO NOTHING

-- First, let's see what swaps will be detected (dry run)
-- Uncomment the INSERT block below to actually insert

-- DRY RUN: Show detected swaps without inserting
SELECT
    w19.user_id,
    w19.player_id AS old_player_id,
    w20.player_id AS new_player_id,
    w19.position,
    20 AS week_number,
    'DETECTED SWAP' AS status
FROM picks w19
JOIN picks w20 ON w19.user_id = w20.user_id
    AND w19.position = w20.position
    AND w20.week_number = 20
WHERE w19.week_number = 19
    -- The new player is different from the old player
    AND w19.player_id != w20.player_id
    -- The old player is NOT present in week 20 (they were replaced)
    AND NOT EXISTS (
        SELECT 1 FROM picks p20_check
        WHERE p20_check.user_id = w19.user_id
        AND p20_check.player_id = w19.player_id
        AND p20_check.week_number = 20
    )
    -- Don't duplicate if already in player_swaps
    AND NOT EXISTS (
        SELECT 1 FROM player_swaps ps
        WHERE ps.user_id = w19.user_id
        AND ps.old_player_id = w19.player_id
        AND ps.new_player_id = w20.player_id
        AND ps.position = w19.position
        AND ps.week_number = 20
    )
ORDER BY w19.user_id, w19.position;

-- ACTUAL BACKFILL: Insert detected swaps into player_swaps
-- Uncomment and run this after verifying the dry run output above

/*
INSERT INTO player_swaps (user_id, old_player_id, new_player_id, position, week_number, swapped_at)
SELECT
    w19.user_id,
    w19.player_id AS old_player_id,
    w20.player_id AS new_player_id,
    w19.position,
    20 AS week_number,
    NOW() AS swapped_at
FROM picks w19
JOIN picks w20 ON w19.user_id = w20.user_id
    AND w19.position = w20.position
    AND w20.week_number = 20
WHERE w19.week_number = 19
    -- The new player is different from the old player
    AND w19.player_id != w20.player_id
    -- The old player is NOT present in week 20 (they were replaced)
    AND NOT EXISTS (
        SELECT 1 FROM picks p20_check
        WHERE p20_check.user_id = w19.user_id
        AND p20_check.player_id = w19.player_id
        AND p20_check.week_number = 20
    )
    -- Don't duplicate if already in player_swaps
    AND NOT EXISTS (
        SELECT 1 FROM player_swaps ps
        WHERE ps.user_id = w19.user_id
        AND ps.old_player_id = w19.player_id
        AND ps.new_player_id = w20.player_id
        AND ps.position = w19.position
        AND ps.week_number = 20
    )
ON CONFLICT DO NOTHING;
*/

-- Verification: Count swaps after backfill
-- SELECT COUNT(*) AS week_20_swap_count FROM player_swaps WHERE week_number = 20;
