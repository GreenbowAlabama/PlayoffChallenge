-- Migration: Add Snapshot Binding to Ledger and Settlement (PGA v1 Section 4.1)
-- Purpose: Enable immutable snapshot binding for deterministic scoring and settlement replay
-- Date: 2026-02-26

-- Add snapshot binding columns to ledger table
ALTER TABLE public.ledger
ADD COLUMN snapshot_id UUID,
ADD COLUMN snapshot_hash TEXT,
ADD COLUMN scoring_run_id UUID;

-- Add constraints and comments for snapshot binding
COMMENT ON COLUMN public.ledger.snapshot_id IS 'Immutable reference to the event data snapshot used for scoring (PGA v1 Section 4.1)';
COMMENT ON COLUMN public.ledger.snapshot_hash IS 'blake3 hash of snapshot data for integrity verification';
COMMENT ON COLUMN public.ledger.scoring_run_id IS 'Reference to the scoring computation that produced this entry';

-- Add snapshot binding columns to settlement_records table
ALTER TABLE public.settlement_records
ADD COLUMN snapshot_id UUID,
ADD COLUMN snapshot_hash TEXT,
ADD COLUMN scoring_run_id UUID;

-- Add constraints and comments for settlement snapshot binding
COMMENT ON COLUMN public.settlement_records.snapshot_id IS 'Immutable reference to the event data snapshot used for settlement computation (PGA v1 Section 4.1)';
COMMENT ON COLUMN public.settlement_records.snapshot_hash IS 'blake3 hash of snapshot data for integrity verification';
COMMENT ON COLUMN public.settlement_records.scoring_run_id IS 'Reference to the scoring computation that produced payouts';

-- Create index on settlement snapshot_id for queries during payout execution
CREATE INDEX settlement_records_snapshot_id_idx ON public.settlement_records(snapshot_id);
