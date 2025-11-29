-- Add image_url column to players table for Sleeper headshot images
-- Run this on production database: psql "$DATABASE_URL" < migrations/add-player-images.sql

ALTER TABLE players ADD COLUMN IF NOT EXISTS image_url VARCHAR(255);

-- The image URL format from Sleeper is:
-- https://sleepercdn.com/content/nfl/players/{sleeper_id}.jpg
-- or https://sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg for thumbnails
