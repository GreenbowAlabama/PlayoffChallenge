BEGIN;
DROP TRIGGER IF EXISTS trg_payout_jobs_set_updated_at ON payout_jobs;
COMMIT;
