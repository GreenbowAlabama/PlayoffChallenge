-- 20260209_contest_lifecycle_gap_01_02_03.sql
-- Purpose: Remove invalid draft contest lifecycle rows
-- Staging-only validation pass

BEGIN;

-- =========================
-- Preflight: inspect impact
-- =========================

-- How many draft rows exist
-- SELECT status, COUNT(*)
-- FROM contests
-- GROUP BY status;

-- Identify orphaned drafts
-- SELECT id, created_at
-- FROM contests
-- WHERE status = 'draft';

-- =========================
-- Migration: destructive
-- =========================

DELETE
FROM contests
WHERE status = 'draft'
  AND published_at IS NULL;

-- =========================
-- Postflight: verify
-- =========================

-- SELECT COUNT(*)
-- FROM contests
-- WHERE status = 'draft';

COMMIT;