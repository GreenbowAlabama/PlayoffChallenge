-- 20260215_settlement_audit_controlled_updates.sql
-- Purpose: Implement controlled update permissions for settlement_audit
-- Governance: Allow status transitions (STARTED -> COMPLETE/FAILED) while remaining append-only for identity fields
-- Iteration 02: Ingestion Safety

BEGIN;

-- =========================
-- Function: prevent_settlement_audit_illegal_update
-- =========================
-- Enforces settlement_audit update constraints:
-- - Always blocks DELETE
-- - Allows UPDATE only if identity/immutable fields unchanged
-- - Validates status transitions STARTED -> COMPLETE|FAILED
-- - Enforces completed_at must be set on state change and NULL on STARTED

CREATE OR REPLACE FUNCTION prevent_settlement_audit_illegal_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  -- Block all DELETE operations
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlement_audit is append-only: deletions are not allowed';
  END IF;

  -- Handle UPDATE operations
  IF TG_OP = 'UPDATE' THEN
    -- ========================================
    -- Identity/Immutable Field Validation
    -- ========================================
    IF NEW.contest_instance_id IS DISTINCT FROM OLD.contest_instance_id THEN
      RAISE EXCEPTION 'settlement_audit identity field contest_instance_id is immutable';
    END IF;

    IF NEW.settlement_run_id IS DISTINCT FROM OLD.settlement_run_id THEN
      RAISE EXCEPTION 'settlement_audit identity field settlement_run_id is immutable';
    END IF;

    IF NEW.engine_version IS DISTINCT FROM OLD.engine_version THEN
      RAISE EXCEPTION 'settlement_audit identity field engine_version is immutable';
    END IF;

    IF NEW.event_ids_applied IS DISTINCT FROM OLD.event_ids_applied THEN
      RAISE EXCEPTION 'settlement_audit identity field event_ids_applied is immutable';
    END IF;

    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'settlement_audit identity field started_at is immutable';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'settlement_audit identity field created_at is immutable';
    END IF;

    -- ========================================
    -- Status Transition Validation
    -- ========================================
    v_old_status := OLD.status;
    v_new_status := NEW.status;

    -- If status is changing, validate the transition
    IF v_new_status IS DISTINCT FROM v_old_status THEN
      -- Only STARTED can transition to other states
      IF v_old_status != 'STARTED' THEN
        RAISE EXCEPTION 'settlement_audit status % cannot transition to %', v_old_status, v_new_status;
      END IF;

      -- Valid target states from STARTED
      IF v_new_status NOT IN ('COMPLETE', 'FAILED') THEN
        RAISE EXCEPTION 'settlement_audit status STARTED can only transition to COMPLETE or FAILED, not %', v_new_status;
      END IF;

      -- When transitioning away from STARTED, completed_at must be set
      IF NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'settlement_audit completed_at must be set when transitioning from STARTED to %', v_new_status;
      END IF;
    ELSE
      -- If status is NOT changing, we're updating other fields while status is STARTED or COMPLETE/FAILED
      -- completed_at must remain NULL if status is STARTED
      IF v_old_status = 'STARTED' AND NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'settlement_audit completed_at must remain NULL while status is STARTED';
      END IF;
    END IF;

    -- If trying to set completed_at but status is STARTED, that's invalid
    IF NEW.status = 'STARTED' AND NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'settlement_audit completed_at must be NULL when status is STARTED';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION prevent_settlement_audit_illegal_update() OWNER TO postgres;

-- =========================
-- Update Triggers
-- =========================
-- Drop old trigger that blocked all updates
DROP TRIGGER IF EXISTS settlement_audit_no_update ON settlement_audit;

-- Create new trigger with controlled update logic
CREATE TRIGGER settlement_audit_guard
  BEFORE UPDATE OR DELETE ON settlement_audit
  FOR EACH ROW
  EXECUTE FUNCTION prevent_settlement_audit_illegal_update();

-- =========================
-- Postflight Verification
-- =========================
-- Verify trigger exists and is active
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'settlement_audit'::regclass;

-- Expected output: settlement_audit_guard | t

COMMIT;
