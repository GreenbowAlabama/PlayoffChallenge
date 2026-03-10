/**
 * Contest Ops Service
 *
 * Provides operational visibility into contest lifecycle, configuration, and health.
 * Used by admin troubleshooting UI to diagnose contest issues.
 *
 * This service is read-only and aggregates data from multiple tables:
 * - contest_instances
 * - contest_templates
 * - tournament_configs (scoped to event family only)
 * - contest_state_transitions
 * - event_data_snapshots
 *
 * Snapshot contract defines what data is available to frontend and what
 * integrity rules can be computed.
 */

/**
 * Get complete operational snapshot for a contest.
 *
 * @param {Object} pool - Database connection pool or client
 * @param {string} contestId - Contest instance UUID
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useProvidedClient - If true, pool is actually a client (for testing)
 * @returns {Promise<Object>} Snapshot object with all operational data
 * @throws {Error} If contest not found or database error
 */
async function getContestOpsSnapshot(pool, contestId, options = {}) {
  const isProvidedClient = options.useProvidedClient === true;
  const client = isProvidedClient ? pool : await pool.connect();
  const shouldRelease = !isProvidedClient;

  try {
    // 1. Server time (reference point for all time-based diagnostics)
    const serverTimeResult = await client.query('SELECT NOW() AS server_time');
    const serverTime = serverTimeResult.rows[0].server_time;

    // 2. Contest instance (includes updated_at for ops visibility)
    const contestResult = await client.query(
      `SELECT
        id,
        contest_name,
        template_id,
        status,
        entry_fee_cents,
        max_entries,
        current_entries,
        lock_time,
        start_time,
        tournament_start_time,
        provider_event_id,
        organizer_id,
        is_platform_owned,
        is_system_generated,
        is_primary_marketing,
        created_at,
        updated_at
      FROM contest_instances
      WHERE id = $1`,
      [contestId]
    );

    if (contestResult.rows.length === 0) {
      throw new Error(`Contest not found: ${contestId}`);
    }

    const contest = contestResult.rows[0];
    const templateId = contest.template_id;
    const contestProviderEventId = contest.provider_event_id;

    // 3. Template
    const templateResult = await client.query(
      `SELECT
        id,
        name,
        sport,
        provider_tournament_id,
        status,
        is_system_generated
      FROM contest_templates
      WHERE id = $1`,
      [templateId]
    );

    const template = templateResult.rows[0] || null;

    // 4. All contest instances for this template (null-safe ordering)
    const templateContestsResult = await client.query(
      `SELECT
        id,
        contest_name,
        status,
        lock_time,
        entry_fee_cents,
        max_entries,
        current_entries,
        organizer_id,
        is_platform_owned,
        is_system_generated,
        is_primary_marketing
      FROM contest_instances
      WHERE template_id = $1
      ORDER BY lock_time NULLS LAST, created_at`,
      [templateId]
    );

    const templateContests = templateContestsResult.rows;

    // 5. Tournament config for THIS contest (single object, not array)
    const contestTournamentConfigResult = await client.query(
      `SELECT
        id,
        provider_event_id,
        event_start_date,
        event_end_date,
        field_source,
        is_active,
        created_at
      FROM tournament_configs
      WHERE contest_instance_id = $1`,
      [contestId]
    );

    const contestTournamentConfig = contestTournamentConfigResult.rows[0] || null;

    // 6. All tournament configs scoped to event family
    // Scope by provider_event_id if present, otherwise by template family
    const scopedConfigsResult = await client.query(
      `SELECT
        tc.id,
        tc.contest_instance_id,
        tc.provider_event_id,
        tc.event_start_date,
        tc.event_end_date,
        tc.field_source,
        tc.is_active,
        tc.created_at,
        ci.contest_name
      FROM tournament_configs tc
      JOIN contest_instances ci ON ci.id = tc.contest_instance_id
      WHERE
        CASE
          WHEN $1::text IS NOT NULL
            THEN tc.provider_event_id = $1::text
          ELSE
            ci.template_id = $2::uuid
        END
      ORDER BY tc.created_at DESC`,
      [contestProviderEventId, templateId]
    );

    const tournamentConfigs = scopedConfigsResult.rows;

    // 7. Lifecycle transitions
    const lifecycleResult = await client.query(
      `SELECT
        from_state,
        to_state,
        triggered_by,
        reason,
        created_at
      FROM contest_state_transitions
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC`,
      [contestId]
    );

    const lifecycleTransitions = lifecycleResult.rows;
    const lifecycleAggregated = {
      current_state: contest.status,
      last_transition: lifecycleTransitions.length > 0 ? lifecycleTransitions[0].created_at : null,
      transition_count: lifecycleTransitions.length
    };

    // 8. Event data snapshots health
    const snapshotHealthResult = await client.query(
      `SELECT
        COUNT(*) AS snapshot_count,
        MAX(ingested_at) AS latest_snapshot
      FROM event_data_snapshots
      WHERE contest_instance_id = $1`,
      [contestId]
    );

    const snapshotHealth = snapshotHealthResult.rows[0] || {
      snapshot_count: 0,
      latest_snapshot: null
    };

    // 9. Ingestion runs (latest 5)
    const ingestionRunsResult = await client.query(
      `SELECT
        work_unit_key,
        status,
        started_at,
        completed_at,
        error_message
      FROM ingestion_runs
      WHERE contest_instance_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
      [contestId]
    );

    const ingestionRuns = ingestionRunsResult.rows;

    // 10. Worker heartbeats (all relevant workers)
    const workersResult = await client.query(
      `SELECT
        worker_name,
        status,
        last_run_at,
        error_count
      FROM worker_heartbeats
      WHERE worker_type IN ('discovery', 'ingestion', 'lifecycle', 'payout', 'reconciliation')
      ORDER BY last_run_at DESC NULLS LAST`
    );

    const workers = workersResult.rows;

    // 11. Player pool info (field_selections)
    const playerPoolResult = await client.query(
      `SELECT
        fs.id,
        fs.created_at,
        (SELECT COUNT(*) FROM jsonb_array_elements(fs.selection_json)) AS player_count
      FROM field_selections fs
      WHERE fs.contest_instance_id = $1`,
      [contestId]
    );

    const playerPool = playerPoolResult.rows.length > 0
      ? {
          exists: true,
          player_count: parseInt(playerPoolResult.rows[0].player_count, 10),
          created_at: playerPoolResult.rows[0].created_at
        }
      : {
          exists: false,
          player_count: 0,
          created_at: null
        };

    // 12. Capacity info
    const capacity = {
      participants_count: parseInt(contest.current_entries, 10),
      max_entries: contest.max_entries ? parseInt(contest.max_entries, 10) : null,
      remaining_slots: contest.max_entries ? Math.max(0, parseInt(contest.max_entries, 10) - parseInt(contest.current_entries, 10)) : null
    };

    // 13. Tournament info
    const tournament = {
      provider_event_id: contestTournamentConfig?.provider_event_id || null,
      event_start_date: contestTournamentConfig?.event_start_date || null,
      event_end_date: contestTournamentConfig?.event_end_date || null,
      is_active: contestTournamentConfig?.is_active || false,
      published_at: contestTournamentConfig?.created_at || null
    };

    // 14. Joinability logic
    const nowTime = serverTime.getTime();
    const lockTime = contest.lock_time ? new Date(contest.lock_time).getTime() : null;

    let joinable = false;
    let reason = 'contest_not_scheduled';

    if (contest.status === 'SCHEDULED') {
      if (lockTime === null || nowTime < lockTime) {
        if (contest.max_entries === null || parseInt(contest.current_entries, 10) < parseInt(contest.max_entries, 10)) {
          joinable = true;
          reason = null;
        } else {
          joinable = false;
          reason = 'contest_full';
        }
      } else {
        joinable = false;
        reason = 'contest_locked';
      }
    } else if (contest.status === 'LOCKED' || contest.status === 'LIVE' || contest.status === 'COMPLETE' || contest.status === 'CANCELLED') {
      joinable = false;
      reason = 'contest_not_scheduled';
    }

    // Return complete snapshot
    return {
      server_time: serverTime,
      contest,
      template,
      template_contests: templateContests,
      contest_tournament_config: contestTournamentConfig,
      tournament_configs: tournamentConfigs,
      lifecycle: {
        transitions: lifecycleTransitions,
        aggregated: lifecycleAggregated
      },
      snapshot_health: {
        snapshot_count: parseInt(snapshotHealth.snapshot_count, 10),
        latest_snapshot: snapshotHealth.latest_snapshot
      },
      capacity,
      tournament,
      player_pool: playerPool,
      ingestion: {
        latest_runs: ingestionRuns
      },
      workers,
      joinability: {
        joinable,
        reason
      }
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

/**
 * Get missing picks aggregation for all contests (or scoped by status).
 *
 * Computes per-contest missing picks = max_entries - participant_count.
 * Useful for Contest Ops dashboard to identify incomplete contests.
 *
 * @param {Object} pool - Database connection pool
 * @param {Array<string>} statuses - Optional filter by contest status (e.g., ['SCHEDULED', 'LOCKED'])
 * @param {boolean} includeZero - Include contests with zero missing picks (default: true)
 * @returns {Promise<Array>} Array of objects with {contest_id, contest_name, max_entries, participant_count, missing_picks, status}
 */
async function getMissingPicks(pool, statuses = null, includeZero = true) {
  let query = `
    SELECT
      ci.id as contest_id,
      ci.contest_name,
      ci.status,
      ci.max_entries,
      ci.tournament_start_time,
      ci.tournament_end_time,
      COUNT(DISTINCT cp.user_id) as participant_count,
      (ci.max_entries - COUNT(DISTINCT cp.user_id)) as missing_picks
    FROM contest_instances ci
    LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
    WHERE ci.is_system_generated = true AND ci.is_platform_owned = true
  `;

  const params = [];

  if (statuses && statuses.length > 0) {
    query += ` AND ci.status = ANY($1::text[])`;
    params.push(statuses);
  }

  query += ` GROUP BY ci.id, ci.contest_name, ci.status, ci.max_entries, ci.tournament_start_time, ci.tournament_end_time
    ORDER BY missing_picks DESC, ci.created_at DESC`;

  const result = await pool.query(query, params);

  const rows = result.rows.map(row => ({
    contest_id: row.contest_id,
    contest_name: row.contest_name,
    status: row.status,
    max_entries: parseInt(row.max_entries, 10),
    participant_count: parseInt(row.participant_count, 10),
    missing_picks: parseInt(row.missing_picks, 10),
    start_time: row.tournament_start_time,
    end_time: row.tournament_end_time
  }));

  // Optionally include contests with zero missing picks
  return includeZero ? rows : rows.filter(c => c.missing_picks > 0);
}

module.exports = {
  getContestOpsSnapshot,
  getMissingPicks
};
