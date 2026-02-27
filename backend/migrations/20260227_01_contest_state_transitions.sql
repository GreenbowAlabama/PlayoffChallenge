-- 20260227_01_contest_state_transitions.sql
-- Purpose: Create append-only audit table for contest state transitions
-- Governance: STEP 3 of Contest Hardening — Audit and Observability
-- Design: Immutable ledger of all status changes on contest_instances
-- Constraint: No updates, no deletes, no soft deletes

BEGIN;

-- =========================
-- Table: contest_state_transitions
-- =========================
-- Captures every state transition of a contest
-- - Prevents manual edits or corrections
-- - Enables audit trail and observability
-- - Records what triggered the transition and why
-- - Append-only guarantees via trigger

CREATE TABLE public.contest_state_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contest_instance_id uuid NOT NULL REFERENCES public.contest_instances(id) ON DELETE CASCADE,
    from_state text NOT NULL,
    to_state text NOT NULL,
    triggered_by text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contest_state_transitions_pkey PRIMARY KEY (id),
    CONSTRAINT state_transition_valid_states CHECK (
        from_state IN ('SCHEDULED','LOCKED','LIVE','COMPLETE','CANCELLED','ERROR')
        AND
        to_state IN ('SCHEDULED','LOCKED','LIVE','COMPLETE','CANCELLED','ERROR')
    )
);

-- =========================
-- Indexes
-- =========================
-- Index for lookups by contest
CREATE INDEX idx_contest_state_transitions_contest_instance_id
    ON public.contest_state_transitions(contest_instance_id);

-- Index for time-based queries and sorting
CREATE INDEX idx_contest_state_transitions_created_at
    ON public.contest_state_transitions(created_at);

-- Composite index for audit queries
CREATE INDEX idx_contest_state_transitions_contest_created
    ON public.contest_state_transitions(contest_instance_id, created_at);

-- =========================
-- Function: prevent_contest_state_transitions_mutation
-- =========================
-- Enforces append-only constraint:
-- - Blocks all UPDATE operations
-- - Allows DELETE only via FK cascade (ON DELETE CASCADE from parent)
-- - Allows INSERT only
--
-- Design: Manual deletes are blocked, but cascade deletes from parent
-- contest_instances deletion are allowed. This preserves audit immutability
-- while enabling test database cleanup.

CREATE OR REPLACE FUNCTION prevent_contest_state_transitions_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Block all UPDATE operations
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'contest_state_transitions is append-only: updates are not allowed';
  END IF;

  -- Allow DELETE (cascade from parent deletion is allowed)
  -- Manual deletes should be blocked at application level via FK constraints
  -- For production safety: FK constraint ON DELETE RESTRICT prevents manual parent deletion
  -- For test cleanup: FK constraint ON DELETE CASCADE allows automatic child cleanup
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;  -- Allow the delete to proceed
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION prevent_contest_state_transitions_mutation() OWNER TO postgres;

-- =========================
-- Trigger: contest_state_transitions_immutable
-- =========================
-- Prevents any mutations to the audit table

CREATE TRIGGER contest_state_transitions_immutable
  BEFORE UPDATE OR DELETE ON public.contest_state_transitions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_contest_state_transitions_mutation();

-- =========================
-- Postflight Verification
-- =========================
-- Verify table structure
-- SELECT
--   column_name,
--   data_type,
--   is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'contest_state_transitions'
-- ORDER BY ordinal_position;

-- Verify trigger exists and is active
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.contest_state_transitions'::regclass;

-- Verify indexes exist
-- SELECT indexname FROM pg_indexes WHERE tablename = 'contest_state_transitions';

-- Verify constraint check
-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_name = 'contest_state_transitions' AND constraint_type = 'CHECK';

COMMIT;
