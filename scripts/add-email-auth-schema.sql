-- Migration: Add Email/Password Authentication Support
-- Date: 2025-12-12
-- Description: Adds support for email/password authentication alongside Apple Sign In

-- 1. Add password_hash column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- 2. Add unique constraint on email (allows NULL, but emails must be unique when present)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
END $$;

-- 3. Make apple_id nullable in users table (should already be nullable, but verify)
ALTER TABLE users ALTER COLUMN apple_id DROP NOT NULL;

-- 4. Make apple_id nullable in signup_attempts table
ALTER TABLE signup_attempts ALTER COLUMN apple_id DROP NOT NULL;

-- 5. Add auth_method column to track how user signed up
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_method VARCHAR(20) DEFAULT 'apple';

-- Verify changes
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'users'
    AND column_name IN ('apple_id', 'email', 'password_hash', 'auth_method')
ORDER BY column_name;

-- Show constraints
SELECT
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'users'::regclass
    AND conname IN ('users_apple_id_key', 'users_email_key');
