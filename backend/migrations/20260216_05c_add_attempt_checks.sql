BEGIN;

ALTER TABLE payout_transfers
  ADD CONSTRAINT payout_transfers_attempt_count_check
  CHECK (attempt_count >= 0);

ALTER TABLE payout_transfers
  ADD CONSTRAINT payout_transfers_max_attempts_check
  CHECK (max_attempts >= 1);

COMMIT;
