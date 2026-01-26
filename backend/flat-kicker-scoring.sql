-- Flat Kicker Scoring Migration
-- This script:
-- 1. Updates scoring_rules table to show flat 3 points for all FG distances
-- 2. Recalculates existing kicker scores using flat scoring logic

BEGIN;

-- =============================================================================
-- PART 1: Update scoring_rules table (for Rules tab display)
-- =============================================================================

-- Update fgm_40_49 from 4 to 3 points
UPDATE scoring_rules
SET points = 3.00,
    description = '3 points for FG 40-49 yards'
WHERE stat_name = 'fgm_40_49';

-- Update fgm_50p from 5 to 3 points
UPDATE scoring_rules
SET points = 3.00,
    description = '3 points for FG 50+ yards'
WHERE stat_name = 'fgm_50p';

-- Verify the updates
SELECT stat_name, points, description
FROM scoring_rules
WHERE category = 'kicking'
ORDER BY display_order;

-- =============================================================================
-- PART 2: Recalculate kicker scores using flat scoring
-- Formula: (fg_made * 3) + (xp_made * 1) - fg_missed - xp_missed
-- =============================================================================

-- First, let's see the current kicker scores before updating
SELECT
    s.id,
    s.user_id,
    s.player_id,
    p.full_name,
    s.week_number,
    s.base_points as old_base_points,
    s.final_points as old_final_points,
    s.multiplier,
    s.stats_json,
    -- Calculate new flat score
    (COALESCE((s.stats_json->>'fg_made')::int, 0) * 3 +
     COALESCE((s.stats_json->>'xp_made')::int, 0) * 1 +
     COALESCE((s.stats_json->>'fg_missed')::int, 0) * -1 +
     COALESCE((s.stats_json->>'xp_missed')::int, 0) * -1) as new_base_points
FROM scores s
JOIN players p ON p.id = s.player_id
WHERE p.position = 'K'
  AND s.stats_json IS NOT NULL
ORDER BY s.week_number, p.full_name;

-- Update kicker scores with flat scoring
UPDATE scores s
SET
    base_points = (
        COALESCE((s.stats_json->>'fg_made')::int, 0) * 3 +
        COALESCE((s.stats_json->>'xp_made')::int, 0) * 1 +
        COALESCE((s.stats_json->>'fg_missed')::int, 0) * -1 +
        COALESCE((s.stats_json->>'xp_missed')::int, 0) * -1
    ),
    points = (
        COALESCE((s.stats_json->>'fg_made')::int, 0) * 3 +
        COALESCE((s.stats_json->>'xp_made')::int, 0) * 1 +
        COALESCE((s.stats_json->>'fg_missed')::int, 0) * -1 +
        COALESCE((s.stats_json->>'xp_missed')::int, 0) * -1
    ),
    final_points = (
        COALESCE((s.stats_json->>'fg_made')::int, 0) * 3 +
        COALESCE((s.stats_json->>'xp_made')::int, 0) * 1 +
        COALESCE((s.stats_json->>'fg_missed')::int, 0) * -1 +
        COALESCE((s.stats_json->>'xp_missed')::int, 0) * -1
    ) * s.multiplier,
    updated_at = NOW()
FROM players p
WHERE p.id = s.player_id
  AND p.position = 'K'
  AND s.stats_json IS NOT NULL;

-- Show updated kicker scores
SELECT
    s.user_id,
    p.full_name,
    s.week_number,
    s.base_points,
    s.multiplier,
    s.final_points,
    s.stats_json->>'fg_made' as fg_made,
    s.stats_json->>'xp_made' as xp_made,
    s.stats_json->>'fg_missed' as fg_missed,
    s.stats_json->>'xp_missed' as xp_missed
FROM scores s
JOIN players p ON p.id = s.player_id
WHERE p.position = 'K'
  AND s.stats_json IS NOT NULL
ORDER BY s.week_number, p.full_name;

COMMIT;
