-- Add stripe_event_id TEXT column to ledger table
--
-- Stripe event IDs (evt_...) are strings, not UUIDs.
-- This column stores the Stripe event ID for traceability and idempotency.
--
-- Idempotency: Multiple inserts with same stripe_event_id will fail on UNIQUE constraint,
-- which is handled by caller (StripeWebhookService catches PG 23505).

ALTER TABLE ledger
ADD COLUMN stripe_event_id TEXT;

-- Index on stripe_event_id for fast lookups (optional but useful for auditing)
CREATE INDEX idx_ledger_stripe_event_id ON ledger(stripe_event_id);

-- Unique constraint on stripe_event_id (NULL-safe: WHERE clause allows multiple NULLs)
CREATE UNIQUE INDEX ledger_stripe_event_id_uq ON ledger(stripe_event_id)
WHERE stripe_event_id IS NOT NULL;
