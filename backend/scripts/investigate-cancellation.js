#!/usr/bin/env node

/**
 * Investigate Contest Cancellation History
 *
 * Traces why contests were cancelled without refund audit trail.
 * Shows state transitions, participant details, and timing.
 *
 * Usage: DATABASE_URL=... node investigate-cancellation.js
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000,
});

async function run() {
  const client = await pool.connect();

  try {
    console.log('\n=== CONTEST CANCELLATION INVESTIGATION ===\n');

    const problematicContests = [
      '26cc5b47-a654-49b3-9ca4-7765881893da',
      '59606d77-2f9e-4964-a869-5d8032e438ce'
    ];

    for (const contestId of problematicContests) {
      console.log(`\n[${'='.repeat(60)}]`);
      console.log(`CONTEST: ${contestId}`);
      console.log(`${'='.repeat(60)}\n`);

      // Get contest instance details
      const contestResult = await client.query(`
        SELECT
          id,
          contest_name,
          status,
          created_at,
          updated_at,
          organizer_id,
          entry_fee_cents,
          start_time,
          lock_time,
          end_time,
          settle_time
        FROM contest_instances
        WHERE id = $1
      `, [contestId]);

      if (contestResult.rows.length === 0) {
        console.log('Contest not found');
        continue;
      }

      const contest = contestResult.rows[0];
      console.log('[1] Contest Instance Details:\n');
      console.log(`  Name: ${contest.contest_name}`);
      console.log(`  Status: ${contest.status}`);
      console.log(`  Created: ${contest.created_at.toISOString()}`);
      console.log(`  Updated: ${contest.updated_at.toISOString()}`);
      console.log(`  Entry Fee: $${(contest.entry_fee_cents / 100).toFixed(2)}`);
      console.log(`  Organizer ID: ${contest.organizer_id}`);
      console.log(`  Timing:`);
      console.log(`    Start: ${contest.start_time?.toISOString() || 'not set'}`);
      console.log(`    Lock: ${contest.lock_time?.toISOString() || 'not set'}`);
      console.log(`    End: ${contest.end_time?.toISOString() || 'not set'}`);
      console.log(`    Settle: ${contest.settle_time?.toISOString() || 'not set'}`);
      console.log();

      // Get state transitions
      const stateResult = await client.query(`
        SELECT
          from_state,
          to_state,
          triggered_by,
          reason,
          created_at
        FROM contest_state_transitions
        WHERE contest_instance_id = $1
        ORDER BY created_at ASC
      `, [contestId]);

      console.log(`[2] State Transitions (${stateResult.rows.length} total):\n`);
      if (stateResult.rows.length === 0) {
        console.log('  No state transitions recorded (pre-audit logging era?)');
      } else {
        for (const trans of stateResult.rows) {
          console.log(`  ${trans.created_at.toISOString()}`);
          console.log(`    ${trans.from_state} → ${trans.to_state}`);
          console.log(`    Triggered by: ${trans.triggered_by}`);
          if (trans.reason) {
            console.log(`    Reason: ${trans.reason}`);
          }
          console.log();
        }
      }

      // Get admin contest audit entries
      const auditResult = await client.query(`
        SELECT
          action,
          from_status,
          to_status,
          reason,
          admin_user_id,
          created_at,
          payload
        FROM admin_contest_audit
        WHERE contest_instance_id = $1
        ORDER BY created_at ASC
      `, [contestId]);

      console.log(`[3] Admin Audit Log (${auditResult.rows.length} entries):\n`);
      if (auditResult.rows.length === 0) {
        console.log('  No admin audit entries (no admin actions recorded)');
      } else {
        for (const audit of auditResult.rows) {
          console.log(`  ${audit.created_at.toISOString()}`);
          console.log(`    Action: ${audit.action}`);
          console.log(`    Status: ${audit.from_status} → ${audit.to_status}`);
          console.log(`    Admin: ${audit.admin_user_id}`);
          console.log(`    Reason: ${audit.reason || '(none)'}`);
          if (audit.payload) {
            console.log(`    Payload: ${JSON.stringify(audit.payload)}`);
          }
          console.log();
        }
      }

      // Get participants
      const participantsResult = await client.query(`
        SELECT
          cp.user_id,
          cp.joined_at,
          u.email,
          u.username
        FROM contest_participants cp
        LEFT JOIN users u ON cp.user_id = u.id
        WHERE cp.contest_instance_id = $1
        ORDER BY cp.joined_at ASC
      `, [contestId]);

      console.log(`[4] Participants (${participantsResult.rows.length} joined):\n`);
      for (const part of participantsResult.rows) {
        console.log(`  User: ${part.username || part.email || part.user_id}`);
        console.log(`    ID: ${part.user_id}`);
        console.log(`    Joined: ${part.joined_at.toISOString()}`);
        console.log();
      }

      // Get ledger entries for this contest
      const ledgerResult = await client.query(`
        SELECT
          entry_type,
          direction,
          amount_cents,
          user_id,
          created_at,
          idempotency_key
        FROM ledger
        WHERE contest_instance_id = $1
        ORDER BY created_at ASC
      `, [contestId]);

      console.log(`[5] Ledger Entries (${ledgerResult.rows.length} total):\n`);
      for (const ledger of ledgerResult.rows) {
        console.log(`  ${ledger.created_at.toISOString()}`);
        console.log(`    ${ledger.entry_type} (${ledger.direction}): $${(ledger.amount_cents / 100).toFixed(2)}`);
        console.log(`    User: ${ledger.user_id.substring(0, 8)}...`);
        console.log(`    Idempotency Key: ${ledger.idempotency_key.substring(0, 32)}...`);
        console.log();
      }

      // Timeline summary
      const minLedgerTime = ledgerResult.rows.length > 0
        ? new Date(Math.min(...ledgerResult.rows.map(r => r.created_at.getTime())))
        : null;
      const minStateTime = stateResult.rows.length > 0
        ? new Date(Math.min(...stateResult.rows.map(r => r.created_at.getTime())))
        : null;
      const minAuditTime = auditResult.rows.length > 0
        ? new Date(Math.min(...auditResult.rows.map(r => r.created_at.getTime())))
        : null;

      console.log(`[6] Timeline Summary:\n`);
      console.log(`  Contest Created: ${contest.created_at.toISOString()}`);
      if (minLedgerTime) console.log(`  First Ledger Entry: ${minLedgerTime.toISOString()}`);
      if (minStateTime) console.log(`  First State Transition: ${minStateTime.toISOString()}`);
      if (minAuditTime) console.log(`  First Admin Audit: ${minAuditTime.toISOString()}`);
      console.log(`  Contest Updated: ${contest.updated_at.toISOString()}`);
      console.log();

      // Diagnosis
      console.log(`[7] Diagnosis:\n`);
      if (stateResult.rows.length === 0 && auditResult.rows.length === 0) {
        console.log('  ⚠ LEGACY CANCELLATION: No audit trail or state transitions.');
        console.log('    Likely cancelled before audit logging was implemented.');
        console.log('    Status was changed directly in database without recording.');
      } else if (stateResult.rows.length > 0 && auditResult.rows.length === 0) {
        console.log('  ⚠ PARTIAL AUDIT: State transitions recorded but no admin audit.');
        console.log('    Cancellation was automated, not admin-triggered.');
      } else if (auditResult.rows.length > 0) {
        console.log('  ℹ NORMAL CANCELLATION: Admin audit trail exists.');
        console.log('    Issue is that refund logic may have failed or been skipped.');
      }
      console.log();
    }

    console.log('\n=== END INVESTIGATION ===\n');

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await client.release();
    await pool.end();
  }
}

run();
