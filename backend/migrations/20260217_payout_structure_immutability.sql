-- Migration: Payout Structure Immutability Trigger
-- Purpose: Prevent payout_structure updates when contest is LOCKED, LIVE, or COMPLETE
-- Iteration 01: Enforce immutability of payout configuration

-- Create function to prevent payout_structure updates when locked
CREATE OR REPLACE FUNCTION public.prevent_payout_update_when_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contest_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payout_structure IS DISTINCT FROM OLD.payout_structure THEN
      -- Fetch current status of the contest
      SELECT status INTO contest_status
      FROM public.contest_instances
      WHERE id = NEW.id;

      -- Prevent updates when contest is LOCKED, LIVE, or COMPLETE
      IF contest_status IN ('LOCKED', 'LIVE', 'COMPLETE') THEN
        RAISE EXCEPTION 'PAYOUT_STRUCTURE_IMMUTABLE_AFTER_LOCK';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on contest_instances (fully qualified)
DROP TRIGGER IF EXISTS trg_prevent_payout_update_when_locked ON public.contest_instances;

CREATE TRIGGER trg_prevent_payout_update_when_locked
BEFORE UPDATE ON public.contest_instances
FOR EACH ROW
EXECUTE FUNCTION public.prevent_payout_update_when_locked();

-- Add comment for audit trail
COMMENT ON FUNCTION public.prevent_payout_update_when_locked() IS
  'Prevents updates to contest_instances.payout_structure when status IN (LOCKED, LIVE, COMPLETE)';
