-- Update main_rules section to remove player selection and deadline mentions
-- Removes first two paragraphs: "Select 1QB..." and "Players must be selected..."

UPDATE rules_content
SET content = 'Players earn points in the playoffs via the configured scoring system, with a bonus multiplier. The fantasy points accumulated by each player during one weekly scoring period will be multiplied by the number of consecutive weeks in which the player has been in your lineup, assuming that player''s team progresses through the playoffs. A player can earn bonus-point multipliers of 2x, 3x or 4x for a given week based on the number of consecutive weeks that player is on the fantasy team roster.

You can swap players out each week based on the matchups, but the multipliers reset with every change, so take that into consideration.

Players that are started the first week of playoffs with a bye, will not score any points that week, but will have a 2x multiplier the following week.'
WHERE section = 'main_rules'
RETURNING id, section, LEFT(content, 100) AS content_preview;
