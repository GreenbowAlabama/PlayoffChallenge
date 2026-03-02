-- Migration: Add wallet_deposit_intents table for QA wallet top-up PaymentIntents
-- Purpose: Track wallet-specific PaymentIntents separately from contest entry fee intents
-- Reason: Wallet deposits have no contest_instance_id; keeping separate avoids schema pollution

CREATE TABLE public.wallet_deposit_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_payment_intent_id text NOT NULL UNIQUE,
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    currency text DEFAULT 'USD' NOT NULL,
    status text NOT NULL DEFAULT 'REQUIRES_CONFIRMATION'
        CHECK (status = ANY (ARRAY['REQUIRES_CONFIRMATION','SUCCEEDED','FAILED','CANCELLED'])),
    idempotency_key text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_wallet_deposit_intents_user_id ON public.wallet_deposit_intents(user_id);
CREATE INDEX idx_wallet_deposit_intents_stripe_pi_id ON public.wallet_deposit_intents(stripe_payment_intent_id);
