/**
 * Contest Lifecycle Service
 *
 * Pure lifecycle transition functions for contest instances.
 * All transitions are deterministic, idempotent, and atomic.
 *
 * This service is responsible for:
 * - Atomic state updates with transition record insertion
 * - Deterministic execution (injected now, no implicit database clock)
 * - Returning changed IDs for observability
 *
 * This service is NOT responsible for:
 * - Contract validation (DB schema enforces via CHECK constraints)
 * - Execution orchestration (when/how to call transitions)
 * - Admin endpoints, background scheduling, or polling loops
 *
 * Execution wiring belongs in a separate orchestration layer.
 */

/**
 * Transition all eligible LOCKED contests to LIVE based on tournament_start_time.
 *
 * Mechanics:
 * - Finds all LOCKED contests where tournament_start_time IS NOT NULL
 * - Checks if injected `now` >= tournament_start_time
 * - Updates status to LIVE (atomic)
 * - Inserts contest_state_transitions records (same transaction)
 * - Idempotent: re-calls do nothing
 *
 * @param {Object} pool - Database connection pool
 * @param {Date} now - Injected current time (for determinism and testability)
 * @returns {Promise<{ changedIds: string[], count: number }>}
 *   changedIds: Array of contest_instance IDs that transitioned
 *   count: Number of contests transitioned
 * @throws {Error} On database errors
 */
async function transitionLockedToLive(pool, now) {
  // Atomic CTE: UPDATE + INSERT transitions in single transaction
  const result = await pool.query(
    `WITH transitioned AS (
       UPDATE contest_instances
       SET status = $1,
           updated_at = $2
       WHERE status = $3
         AND tournament_start_time IS NOT NULL
         AND $2 >= tournament_start_time
       RETURNING id
     )
     INSERT INTO contest_state_transitions (
       contest_instance_id,
       from_state,
       to_state,
       triggered_by,
       reason,
       created_at
     )
     SELECT
       id,
       $3,
       $1,
       'TOURNAMENT_START_TIME_REACHED',
       'Automatic transition at tournament start time',
       $2
     FROM transitioned
     RETURNING contest_instance_id`,
    ['LIVE', now, 'LOCKED']
  );

  const changedIds = result.rows.map(row => row.contest_instance_id);

  return {
    changedIds,
    count: changedIds.length
  };
}

module.exports = {
  transitionLockedToLive
};
