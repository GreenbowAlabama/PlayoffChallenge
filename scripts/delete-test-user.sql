--
-- Delete Test User - Quick UI Retest Script
-- Purpose: Delete a specific user to retest the signup flow
-- Date: 2025-12-12
--
-- USAGE:
--   Option 1: Delete by Apple ID
--     psql "$DATABASE_URL" -v apple_id="'001234.abc...'" -f scripts/delete-test-user.sql
--
--   Option 2: Delete by email
--     psql "$DATABASE_URL" -v email="'test@example.com'" -f scripts/delete-test-user.sql
--
--   Option 3: Edit this file and replace the WHERE clause below
--

BEGIN;

-- Show user before deletion
SELECT 'User to delete:' AS status;
SELECT id, apple_id, email, name, state, created_at
FROM users
WHERE apple_id = :apple_id  -- Replace with actual Apple ID or use -v flag
   OR email = :email;       -- Or replace with email

-- Delete user and all related data (CASCADE handles foreign keys)
DELETE FROM users
WHERE apple_id = :apple_id
   OR email = :email;

-- Show result
SELECT 'Deletion complete' AS status;
SELECT COUNT(*) AS remaining_users FROM users;

COMMIT;
