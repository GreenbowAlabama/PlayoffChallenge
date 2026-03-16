/**
 * Verify lifecycle completion state after fix.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/debug/verify-lifecycle-completion.js
 *
 * This script checks:
 * 1. Contest status matches expected COMPLETE state
 * 2. LIVE→COMPLETE transitions are recorded
 * 3. Settlement records exist with settled_at timestamps
 * 4. No contests stuck in limbo (settled but status=LIVE)
 */

const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('\n=== CONTEST STATUS CHECK ===\n');

    // Check contests for the event mentioned in the issue
    const contests = await pool.query(`
      SELECT
        id,
        contest_name,
        status,
        tournament_end_time,
        created_at
      FROM contest_instances
      WHERE provider_event_id = 'espn_pga_401811937'
      ORDER BY entry_fee_cents
    `);

    console.log('Contests for espn_pga_401811937:');
    if (contests.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.table(contests.rows.map(r => ({
        contest_name: r.contest_name,
        status: r.status,
        tournament_end_time: r.tournament_end_time ? new Date(r.tournament_end_time).toISOString() : null,
        created_at: new Date(r.created_at).toISOString()
      })));
    }

    console.log('\n=== LIFECYCLE TRANSITIONS ===\n');

    // Check recent LIVE→COMPLETE transitions
    const transitions = await pool.query(`
      SELECT
        contest_instance_id,
        from_state,
        to_state,
        triggered_by,
        created_at
      FROM contest_state_transitions
      WHERE to_state = 'COMPLETE'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log('Recent COMPLETE transitions (limit 10):');
    if (transitions.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.table(transitions.rows.map(r => ({
        from_state: r.from_state,
        to_state: r.to_state,
        triggered_by: r.triggered_by,
        created_at: new Date(r.created_at).toISOString()
      })));
    }

    console.log('\n=== SETTLEMENT RECORDS ===\n');

    // Check settlement records
    const settlements = await pool.query(`
      SELECT
        contest_instance_id,
        settled_at,
        created_at,
        participant_count,
        total_pool_cents
      FROM settlement_records
      WHERE created_at > NOW() - INTERVAL '5 days'
      ORDER BY settled_at DESC
      LIMIT 10
    `);

    console.log('Recent settlement records (limit 10):');
    if (settlements.rows.length === 0) {
      console.log('  (none found)');
    } else {
      console.table(settlements.rows.map(r => ({
        settled_at: r.settled_at ? new Date(r.settled_at).toISOString() : null,
        created_at: new Date(r.created_at).toISOString(),
        participant_count: r.participant_count,
        pool_cents: r.total_pool_cents
      })));
    }

    console.log('\n=== SETTLEMENT LIMBO CHECK ===\n');

    // Check for contests in limbo (settled but status still LIVE)
    const limbo = await pool.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        sr.settled_at,
        sr.created_at as settlement_created_at
      FROM contest_instances ci
      JOIN settlement_records sr ON sr.contest_instance_id = ci.id
      WHERE ci.status = 'LIVE'
        AND sr.settled_at IS NOT NULL
      ORDER BY sr.settled_at DESC
    `);

    if (limbo.rows.length === 0) {
      console.log('✅ No contests in settlement limbo (good!)');
    } else {
      console.log('⚠️  FOUND ' + limbo.rows.length + ' contests in limbo:');
      console.table(limbo.rows.map(r => ({
        contest_name: r.contest_name,
        status: r.status,
        settled_at: new Date(r.settled_at).toISOString(),
        settlement_created_at: new Date(r.settlement_created_at).toISOString()
      })));
      console.log('\n  These contests have settlements but status is still LIVE (BUG)');
    }

    console.log('\n=== WORKER HEARTBEAT ===\n');

    // Check lifecycle reconciler heartbeat
    const heartbeat = await pool.query(`
      SELECT
        worker_name,
        status,
        last_run_at,
        error_count,
        metadata
      FROM worker_heartbeats
      WHERE worker_name = 'lifecycle_reconciler'
      ORDER BY last_run_at DESC
      LIMIT 1
    `);

    if (heartbeat.rows.length === 0) {
      console.log('⚠️  No heartbeat found for lifecycle_reconciler (worker may not have run)');
    } else {
      const hb = heartbeat.rows[0];
      console.log('Lifecycle Reconciler Status:');
      console.log('  Status:', hb.status);
      console.log('  Last Run:', hb.last_run_at ? new Date(hb.last_run_at).toISOString() : 'never');
      console.log('  Error Count:', hb.error_count);
      console.log('  Metadata:', hb.metadata ? JSON.parse(hb.metadata) : null);
    }

  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
