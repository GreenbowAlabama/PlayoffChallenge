-- 20260215_add_client_secret_to_payment_intents.sql
-- Purpose: Store Stripe client_secret in payment_intents for idempotent returns
-- Iteration 03: Payment Hardening - Atomic Transactions

BEGIN;

ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS stripe_client_secret text;

COMMENT ON COLUMN payment_intents.stripe_client_secret IS 'Stripe payment intent client_secret for Stripe.js frontend integration. Stored for idempotent retry returns.';

COMMIT;
