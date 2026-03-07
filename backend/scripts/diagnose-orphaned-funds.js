#!/usr/bin/env node

/**
 * Diagnose Orphaned Funds Issue
 *
 * Investigates why two cancelled contests have unrefunded entry fees.
 * Shows audit trail, ledger entries, and reconciliation status.
 *
 * Usage: DATABASE_URL=... node diagnose-orphaned-funds.js
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
    console.log('\n=== ORPHANED FUNDS DIAGNOSIS ===\n');

    // 1. Get all cancelled contests with stranded entry fees
    console.log('[1] Cancelled Contests with Stranded Funds:\n');
    const strandedResult = await client.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.created_at,
        COUNT(DISTINCT l.user_id) as affected_user_count,
        SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as total_stranded_cents
      FROM contest_instances ci
      LEFT JOIN ledger l ON ci.id = l.contest_instance_id
        AND l.entry_type = 'ENTRY_FEE'
        AND l.direction = 'DEBIT'
      WHERE ci.status = 'CANCELLED'
      GROUP BY ci.id, ci.contest_name, ci.status, ci.created_at
      HAVING SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) > 0
      ORDER BY total_stranded_cents DESC
    `);

    console.log(`Found ${strandedResult.rows.length} cancelled contests with stranded funds:\n`);
    for (const row of strandedResult.rows) {
      console.log(`  Contest: ${row.contest_name} (ID: ${row.id})`);
      console.log(`    Created: ${row.created_at}`);
      console.log(`    Affected Users: ${row.affected_user_count}`);
      console.log(`    Stranded Amount: $${(row.total_stranded_cents / 100).toFixed(2)}`);
      console.log();
    }

    // 2. For each stranded contest, show audit trail
    for (const contest of strandedResult.rows) {
      console.log(`[2] Audit Trail for ${contest.contest_name}:\n`);

      const auditResult = await client.query(`
        SELECT
          id,
          created_at,
          action,
          from_status,
          to_status,
          reason,
          payload
        FROM admin_contest_audit
        WHERE contest_instance_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [contest.id]);

      if (auditResult.rows.length === 0) {
        console.log('  No audit trail found (legacy cancellation?)\n');
      } else {
        for (const audit of auditResult.rows) {
          console.log(`  ${audit.created_at.toISOString()}`);
          console.log(`    Action: ${audit.action}`);
          console.log(`    Status: ${audit.from_status} → ${audit.to_status}`);
          console.log(`    Reason: ${audit.reason || '(none)'}`);
          if (audit.payload) {
            console.log(`    Payload: ${JSON.stringify(audit.payload)}`);
          }
          console.log();
        }
      }

      // 3. Show ledger entries for this contest
      console.log(`[3] Ledger Entries for ${contest.contest_name}:\n`);

      const ledgerResult = await client.query(`
        SELECT
          entry_type,
          direction,
          user_id,
          amount_cents,
          idempotency_key,
          created_at
        FROM ledger
        WHERE contest_instance_id = $1
        ORDER BY created_at ASC
      `, [contest.id]);

      console.log(`  Total ledger entries: ${ledgerResult.rows.length}\n`);

      let entryFeeDebits = 0;
      let entryFeeRefundCredits = 0;
      let otherEntries = [];

      for (const entry of ledgerResult.rows) {
        if (entry.entry_type === 'ENTRY_FEE' && entry.direction === 'DEBIT') {
          entryFeeDebits += entry.amount_cents;
          console.log(`  ENTRY_FEE DEBIT: $${(entry.amount_cents / 100).toFixed(2)} from ${entry.user_id.substring(0, 8)}...`);
        } else if (entry.entry_type === 'ENTRY_FEE_REFUND' && entry.direction === 'CREDIT') {
          entryFeeRefundCredits += entry.amount_cents;
          console.log(`  ENTRY_FEE_REFUND CREDIT: $${(entry.amount_cents / 100).toFixed(2)} to ${entry.user_id.substring(0, 8)}...`);
        } else {
          otherEntries.push(entry);
        }
      }

      console.log(`\n  Summary:`);
      console.log(`    Entry Fee Debits (charged): $${(entryFeeDebits / 100).toFixed(2)}`);
      console.log(`    Entry Fee Refunds (refunded): $${(entryFeeRefundCredits / 100).toFixed(2)}`);
      console.log(`    Outstanding Refunds Owed: $${((entryFeeDebits - entryFeeRefundCredits) / 100).toFixed(2)}`);

      if (otherEntries.length > 0) {
        console.log(`    Other entries: ${otherEntries.length}`);
        for (const entry of otherEntries) {
          console.log(`      - ${entry.entry_type} (${entry.direction}): $${(entry.amount_cents / 100).toFixed(2)}`);
        }
      }
      console.log();
    }

    // 4. Overall financial health check
    console.log('[4] Overall Financial Health:\n');

    const healthResult = await client.query(`
      SELECT
        (SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents ELSE 0 END), 0)
         FROM ledger WHERE reference_type = 'WALLET') as wallet_balance,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents ELSE 0 END), 0)
         FROM ledger WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND', 'PRIZE_PAYOUT', 'PRIZE_PAYOUT_REVERSAL')) as contest_pool,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) FROM ledger) as total_credits,
        (SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) FROM ledger) as total_debits
    `);

    const health = healthResult.rows[0];
    const walletBalance = parseInt(health.wallet_balance, 10);
    const contestPool = parseInt(health.contest_pool, 10);
    const totalCredits = parseInt(health.total_credits, 10);
    const totalDebits = parseInt(health.total_debits, 10);
    const net = totalCredits - totalDebits;

    console.log(`  Wallet Balance: $${(walletBalance / 100).toFixed(2)}`);
    console.log(`  Contest Pool Balance: $${(contestPool / 100).toFixed(2)}`);
    console.log(`  Total Ledger Credits: $${(totalCredits / 100).toFixed(2)}`);
    console.log(`  Total Ledger Debits: $${(totalDebits / 100).toFixed(2)}`);
    console.log(`  Ledger Net (Credits - Debits): $${(net / 100).toFixed(2)}`);
    console.log(`  Ledger Balanced: ${totalCredits - totalDebits === net ? 'YES' : 'NO'}`);
    console.log();

    // 5. Refund eligibility check
    console.log('[5] Refund Eligibility (via Cleanup API):\n');
    console.log('  To refund stranded funds, call:');
    for (const contest of strandedResult.rows) {
      console.log(`    POST /api/admin/orphaned-funds/${contest.id}/refund-all`);
      console.log(`      Body: { "reason": "Auto-refund from diagnostic script" }`);
    }
    console.log();

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
