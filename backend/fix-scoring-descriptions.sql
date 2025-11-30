-- Fix incorrect scoring rule descriptions

-- Fix receptions description (1.0 PPR, not 0.5)
UPDATE scoring_rules
SET description = '1 point per reception (PPR)'
WHERE stat_name = 'rec';

-- Fix receiving yards description (already correct at 0.1 = 1 per 10 yards, but let's make it clearer)
UPDATE scoring_rules
SET description = '1 point per 10 receiving yards'
WHERE stat_name = 'rec_yd';

-- Display updated rules
SELECT stat_name, points, description
FROM scoring_rules
WHERE stat_name IN ('rec', 'rec_yd')
ORDER BY stat_name;
