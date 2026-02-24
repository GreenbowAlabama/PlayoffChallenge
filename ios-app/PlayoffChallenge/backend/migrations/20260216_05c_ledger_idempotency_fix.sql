BEGIN;

-- 1. Drop partial unique index
DROP INDEX IF EXISTS ledger_idempotency_key_uq;

-- 2. Ensure no NULL idempotency keys exist
-- (This will error if any NULL rows exist)
ALTER TABLE ledger
  ALTER COLUMN idempotency_key SET NOT NULL;

-- 3. Add proper unique constraint
ALTER TABLE ledger
  ADD CONSTRAINT ledger_idempotency_key_unique
  UNIQUE (idempotency_key);

COMMIT;
