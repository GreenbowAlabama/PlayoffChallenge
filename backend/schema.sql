-- Create database (run this first)
-- CREATE DATABASE playoff_challenge;

-- Connect to the database then run the rest:

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_user_id VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) NOT NULL,
  team_name VARCHAR(100),
  paid BOOLEAN DEFAULT FALSE,
  payment_method VARCHAR(50),
  payment_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  position VARCHAR(10) NOT NULL,
  team VARCHAR(10) NOT NULL,
  available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Picks table
CREATE TABLE picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  week INT NOT NULL,
  locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, player_id, week)
);

-- Scores table
CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  week INT NOT NULL,
  points DECIMAL(10, 2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_picks_user_id ON picks(user_id);
CREATE INDEX idx_picks_week ON picks(week);
CREATE INDEX idx_scores_user_id ON scores(user_id);
CREATE INDEX idx_scores_week ON scores(week);

-- Sample data (optional - for testing)
INSERT INTO players (name, position, team) VALUES
  ('Patrick Mahomes', 'QB', 'KC'),
  ('Josh Allen', 'QB', 'BUF'),
  ('Christian McCaffrey', 'RB', 'SF'),
  ('Travis Kelce', 'TE', 'KC'),
  ('Tyreek Hill', 'WR', 'MIA');