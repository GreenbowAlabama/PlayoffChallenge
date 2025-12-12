--
-- Compliance Schema Update - Phase 1
-- Purpose: Add compliance and eligibility fields to users table
-- Date: 2025-12-12
--
-- ADDS TO USERS TABLE:
--   - state: User's self-certified state of residence
--   - ip_state_verified: State from IP geolocation (for audit)
--   - state_certification_date: When user certified their state
--   - eligibility_confirmed_at: When user confirmed eligibility
--   - tos_version: Version of TOS user agreed to
--   - tos_accepted_at: When user accepted TOS
--   - age_verified: Age 18+ confirmation
--

BEGIN;

-- Show current users table structure
SELECT 'BEFORE: Current users table columns' AS status;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Add state & eligibility tracking columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_state_verified VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS state_certification_date TIMESTAMP;

-- Add TOS & age verification columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS eligibility_confirmed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified BOOLEAN DEFAULT FALSE;

-- Add indexes for compliance queries
CREATE INDEX IF NOT EXISTS idx_users_state ON users(state);
CREATE INDEX IF NOT EXISTS idx_users_eligibility ON users(eligibility_confirmed_at);

-- Add column comments for documentation
COMMENT ON COLUMN users.state IS 'User self-certified state of residence (2-letter code)';
COMMENT ON COLUMN users.ip_state_verified IS 'State derived from IP geolocation at signup (may differ from claimed state)';
COMMENT ON COLUMN users.state_certification_date IS 'When user certified their state eligibility';
COMMENT ON COLUMN users.eligibility_confirmed_at IS 'When user confirmed age and eligibility requirements';
COMMENT ON COLUMN users.tos_version IS 'Version of Terms of Service user agreed to (e.g., 2025-12-12)';
COMMENT ON COLUMN users.tos_accepted_at IS 'When user accepted the Terms of Service';
COMMENT ON COLUMN users.age_verified IS 'Whether user confirmed they are 18+ years old';

-- Show updated users table structure
SELECT 'AFTER: Updated users table columns' AS status;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Show new indexes
SELECT 'New indexes created:' AS status;
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'users'
  AND indexname IN ('idx_users_state', 'idx_users_eligibility');

COMMIT;

SELECT '✅ Schema update completed successfully' AS final_status;
