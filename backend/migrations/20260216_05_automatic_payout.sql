BEGIN;

-- ---------------------------------------------------------------------
-- Iteration 05: Automatic Payout Execution
-- Canonical schema for BOTH staging ($DATABASE_URL) and test ($DATABASE_URL_TEST)
-- ---------------------------------------------------------------------

-- Safety: if you already have a dedicated schema for extensions, ignore this.
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- payout_jobs
CREATE TABLE IF NOT EXISTS payout_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  settlement_id UUID NOT NULL UNIQUE,
  contest_id UUID NOT NULL REFERENCES contest_instances(id),

  status TEXT NOT NULL CHECK (status IN ('pending','processing','complete')),

  total_payouts INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,

  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_jobs_contest_id
  ON payout_jobs(contest_id);

-- payout_transfers
CREATE TABLE IF NOT EXISTS payout_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  payout_job_id UUID NOT NULL REFERENCES payout_jobs(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES contest_instances(id),
  user_id UUID NOT NULL REFERENCES users(id),

  amount_cents INT NOT NULL CHECK (amount_cents > 0),

  status TEXT NOT NULL CHECK (status IN ('pending','processing','retryable','completed','failed_terminal')),

  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),

  stripe_transfer_id TEXT NULL,

  idempotency_key TEXT NOT NULL,
  failure_reason TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniques for idempotency and payout correctness
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transfers_idempotency_key
  ON payout_transfers(idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_transfers_contest_user
  ON payout_transfers(contest_id, user_id);

-- Common query indexes
CREATE INDEX IF NOT EXISTS idx_payout_transfers_job_id
  ON payout_transfers(payout_job_id);

CREATE INDEX IF NOT EXISTS idx_payout_transfers_status
  ON payout_transfers(status);

CREATE INDEX IF NOT EXISTS idx_payout_transfers_contest_status
  ON payout_transfers(contest_id, status);

-- updated_at triggers (use a local function so you do not depend on other migrations)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payout_jobs_set_updated_at ON payout_jobs;
CREATE TRIGGER trg_payout_jobs_set_updated_at
BEFORE UPDATE ON payout_jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payout_transfers_set_updated_at ON payout_transfers;
CREATE TRIGGER trg_payout_transfers_set_updated_at
BEFORE UPDATE ON payout_transfers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
