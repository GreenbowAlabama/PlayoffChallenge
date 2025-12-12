--
-- Signup Attempts Audit Table - Phase 2
-- Purpose: Track all signup attempts (successful and blocked) for compliance auditing
-- Date: 2025-12-12
--
-- TRACKS:
--   - All signup attempts (even if blocked)
--   - Restricted state attempts
--   - IP geolocation mismatches
--   - Blocking reasons
--
-- USED FOR:
--   - Compliance reporting
--   - Analytics (how many users from restricted states tried to sign up)
--   - Audit trail for regulators
--

BEGIN;

-- Create signup_attempts table
CREATE TABLE IF NOT EXISTS signup_attempts (
    id SERIAL PRIMARY KEY,
    apple_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    name VARCHAR(255),
    attempted_state VARCHAR(2),
    ip_state_verified VARCHAR(2),
    blocked BOOLEAN DEFAULT FALSE,
    blocked_reason VARCHAR(100),
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_signup_attempts_state ON signup_attempts(attempted_state);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_blocked ON signup_attempts(blocked);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_apple_id ON signup_attempts(apple_id);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_attempted_at ON signup_attempts(attempted_at DESC);

-- Add table comment
COMMENT ON TABLE signup_attempts IS 'Audit log of all signup attempts, including blocked ones for compliance reporting';

-- Add column comments
COMMENT ON COLUMN signup_attempts.apple_id IS 'Apple ID of user attempting signup';
COMMENT ON COLUMN signup_attempts.attempted_state IS 'State user selected during signup';
COMMENT ON COLUMN signup_attempts.ip_state_verified IS 'State derived from IP geolocation';
COMMENT ON COLUMN signup_attempts.blocked IS 'Whether signup was blocked';
COMMENT ON COLUMN signup_attempts.blocked_reason IS 'Reason for blocking (e.g., "Restricted state")';

-- Show table structure
SELECT 'Table created:' AS status;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'signup_attempts'
ORDER BY ordinal_position;

-- Show indexes
SELECT 'Indexes created:' AS status;
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'signup_attempts';

COMMIT;

SELECT '✅ Signup attempts table created successfully' AS final_status;
