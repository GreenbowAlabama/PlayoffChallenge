/**
 * Remove redundant entry_rosters trigger.
 *
 * RATIONALE:
 * - The trigger unconditionally sets updated_at = now() on EVERY UPDATE
 * - But submitPicks.js already explicitly sets updated_at = now() in the UPDATE clause
 * - Having both causes DOUBLE now() calls → potential timestamp mismatches → 409 CONCURRENT_MODIFICATION races
 * - This is a DATA OWNERSHIP VIOLATION: background system mutating user-owned state without audit
 *
 * FIX:
 * - Remove the trigger (logic now owned by submitPicks API exclusively)
 * - Keep explicit updated_at = now() in submitPicks UPDATE clause
 * - Add explicit audit logging in submitPicks for all entry_rosters mutations
 *
 * GOVERNANCE:
 * - entry_rosters is USER-OWNED state
 * - Only the user's explicit API calls (POST /picks) may modify it
 * - No background workers, reconcilers, or scheduled tasks may touch it
 */

DROP TRIGGER IF EXISTS trg_entry_rosters_updated_at ON public.entry_rosters;
DROP FUNCTION IF EXISTS public.set_entry_rosters_updated_at();
