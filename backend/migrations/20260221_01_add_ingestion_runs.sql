-- Migration: 20260221_01_add_ingestion_runs
--
-- Adds:
--   1. ingestion_runs table — idempotency tracking for the ingestion pipeline.
--   2. ingestion_strategy_key column on contest_templates — allows templates to
--      specify which adapter to use. Nullable; ingestionService defaults to
--      'nfl_espn' when null.
--
-- This migration is safe to run against existing data.
-- All new columns/tables are additive only. No renames, no drops.

-- ── 1. ingestion_runs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_instance_id    UUID         NOT NULL,
  ingestion_strategy_key TEXT         NOT NULL,
  work_unit_key          TEXT         NOT NULL,
  status                 TEXT         NOT NULL CHECK (status IN ('RUNNING', 'COMPLETE', 'ERROR')),
  started_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ,
  error_message          TEXT,
  metadata_json          JSONB,

  CONSTRAINT ingestion_runs_contest_fk
    FOREIGN KEY (contest_instance_id)
    REFERENCES contest_instances(id)
    ON DELETE CASCADE,

  CONSTRAINT ingestion_runs_unique_work_unit
    UNIQUE (contest_instance_id, work_unit_key)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_contest_instance
  ON ingestion_runs (contest_instance_id);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status
  ON ingestion_runs (status);

-- ── 2. ingestion_strategy_key on contest_templates ────────────────────────────

ALTER TABLE contest_templates
  ADD COLUMN IF NOT EXISTS ingestion_strategy_key TEXT;

COMMENT ON COLUMN contest_templates.ingestion_strategy_key IS
  'Ingestion adapter key (e.g. nfl_espn, pga_espn). NULL defaults to nfl_espn in ingestionService.';
