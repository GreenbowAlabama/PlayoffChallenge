#!/usr/bin/env node

/**
 * Ledger Diagnostic Script
 *
 * Purpose: Identify test contests causing financial imbalance
 * Output: writes results to LEDGER_DIAGNOSTIC_RESULTS.json
 *
 * Run from repo root:
 * DATABASE_URL="postgres://..." node backend/scripts/ledger-diagnostic.js
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

async function runDiagnostics() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const results = {
      timestamp: new Date().toISOString(),
      database_url: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      diagnostics: {}
    };

    // 1. All contests with ledger impact
    console.log('\n[1] Fetching all contests...');
    const contestsResult = await client.query(`
      SELECT
        ci.id,
        ci.contest_name,
        ci.status,
        ci.created_at,
        COUNT(DISTINCT cp.user_id) as participant_count
      FROM contest_instances ci
      LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
      GROUP BY ci.id, ci.contest_name, ci.status, ci.created_at
      ORDER BY ci.created_at DESC
    `);

    results.diagnostics.all_contests = contestsResult.rows;
    console.log(`Found ${contestsResult.rows.length} contests`);

    // 2. Contest pool summary
    console.log('\n[2] Fetching contest pool balances...');
    const poolResult = await client.query(`
      WITH contest_ledger AS (
        SELECT
          ci.id,
          ci.contest_name,
          ci.status,
          COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_debits_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_refunds_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as prize_payout_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT_REVERSAL' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as prize_reversal_cents
        FROM contest_instances ci
        LEFT JOIN ledger l ON ci.id = l.contest_instance_id
        GROUP BY ci.id, ci.contest_name, ci.status
      )
      SELECT
        id,
        contest_name,
        status,
        entry_fee_debits_cents,
        entry_fee_refunds_cents,
        (entry_fee_debits_cents - entry_fee_refunds_cents) as entry_fee_net_cents,
        prize_payout_cents,
        prize_reversal_cents,
        (prize_payout_cents - prize_reversal_cents) as prize_net_cents,
        (entry_fee_debits_cents - entry_fee_refunds_cents) - (prize_payout_cents - prize_reversal_cents) as pool_balance_cents
      FROM contest_ledger
      ORDER BY pool_balance_cents ASC
    `);

    results.diagnostics.contest_pool_balances = poolResult.rows.map(row => ({
      contest_id: row.id,
      contest_name: row.contest_name,
      status: row.status,
      entry_fee_debits_dollars: (row.entry_fee_debits_cents / 100).toFixed(2),
      entry_fee_refunds_dollars: (row.entry_fee_refunds_cents / 100).toFixed(2),
      entry_fee_net_dollars: (row.entry_fee_net_cents / 100).toFixed(2),
      prize_payout_dollars: (row.prize_payout_cents / 100).toFixed(2),
      prize_reversal_dollars: (row.prize_reversal_cents / 100).toFixed(2),
      prize_net_dollars: (row.prize_net_cents / 100).toFixed(2),
      pool_balance_dollars: (row.pool_balance_cents / 100).toFixed(2),
      is_negative: row.pool_balance_cents < 0
    }));

    // 3. Negative pool contests only
    console.log('\n[3] Fetching negative pool contests...');
    const negativeResult = await client.query(`
      WITH contest_ledger AS (
        SELECT
          ci.id,
          ci.contest_name,
          ci.status,
          ci.created_at,
          COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_debits_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'ENTRY_FEE_REFUND' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as entry_fee_refunds_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT' AND l.direction = 'CREDIT' THEN l.amount_cents ELSE 0 END), 0) as prize_payout_cents,
          COALESCE(SUM(CASE WHEN l.entry_type = 'PRIZE_PAYOUT_REVERSAL' AND l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END), 0) as prize_reversal_cents
        FROM contest_instances ci
        LEFT JOIN ledger l ON ci.id = l.contest_instance_id
        GROUP BY ci.id, ci.contest_name, ci.status, ci.created_at
      )
      SELECT
        id,
        contest_name,
        status,
        created_at,
        entry_fee_debits_cents,
        entry_fee_refunds_cents,
        prize_payout_cents,
        prize_reversal_cents,
        ((entry_fee_debits_cents - entry_fee_refunds_cents) - (prize_payout_cents - prize_reversal_cents)) as pool_balance_cents
      FROM contest_ledger
      WHERE ((entry_fee_debits_cents - entry_fee_refunds_cents) - (prize_payout_cents - prize_reversal_cents)) < 0
      ORDER BY pool_balance_cents ASC
    `);

    results.diagnostics.negative_pool_contests = negativeResult.rows.map(row => ({
      contest_id: row.id,
      contest_name: row.contest_name,
      status: row.status,
      created_at: row.created_at,
      entry_fee_debits_dollars: (row.entry_fee_debits_cents / 100).toFixed(2),
      entry_fee_refunds_dollars: (row.entry_fee_refunds_cents / 100).toFixed(2),
      prize_payout_dollars: (row.prize_payout_cents / 100).toFixed(2),
      prize_reversal_dollars: (row.prize_reversal_cents / 100).toFixed(2),
      pool_balance_dollars: (row.pool_balance_cents / 100).toFixed(2)
    }));

    // 4. Total contest pool balance
    console.log('\n[4] Calculating total contest pool balance...');
    const totalPoolResult = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as total_entry_fees_cents,
        COALESCE(SUM(CASE WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as total_refunds_cents,
        COALESCE(SUM(CASE WHEN entry_type = 'PRIZE_PAYOUT' AND direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as total_payouts_cents,
        COALESCE(SUM(CASE WHEN entry_type = 'PRIZE_PAYOUT_REVERSAL' AND direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as total_reversals_cents
      FROM ledger
      WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND', 'PRIZE_PAYOUT', 'PRIZE_PAYOUT_REVERSAL')
    `);

    const tp = totalPoolResult.rows[0];
    const totalPoolBalance = (tp.total_entry_fees_cents - tp.total_refunds_cents - tp.total_payouts_cents + tp.total_reversals_cents);

    results.diagnostics.total_contest_pool = {
      total_entry_fees_dollars: (tp.total_entry_fees_cents / 100).toFixed(2),
      total_refunds_dollars: (tp.total_refunds_cents / 100).toFixed(2),
      total_payouts_dollars: (tp.total_payouts_cents / 100).toFixed(2),
      total_reversals_dollars: (tp.total_reversals_cents / 100).toFixed(2),
      net_balance_dollars: (totalPoolBalance / 100).toFixed(2)
    };

    // 5. Wallet ledger summary
    console.log('\n[5] Calculating wallet ledger summary...');
    const walletResult = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as wallet_credits_cents,
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as wallet_debits_cents
      FROM ledger
      WHERE reference_type = 'WALLET'
    `);

    const w = walletResult.rows[0];
    results.diagnostics.wallet_ledger = {
      total_credits_dollars: (w.wallet_credits_cents / 100).toFixed(2),
      total_debits_dollars: (w.wallet_debits_cents / 100).toFixed(2),
      net_balance_dollars: ((w.wallet_credits_cents - w.wallet_debits_cents) / 100).toFixed(2)
    };

    // 6. Full ledger integrity
    console.log('\n[6] Calculating full ledger integrity...');
    const integrityResult = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0) as total_credits_cents,
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0) as total_debits_cents
      FROM ledger
    `);

    const i = integrityResult.rows[0];
    results.diagnostics.full_ledger_integrity = {
      total_credits_dollars: (i.total_credits_cents / 100).toFixed(2),
      total_debits_dollars: (i.total_debits_cents / 100).toFixed(2),
      net_balance_dollars: ((i.total_credits_cents - i.total_debits_cents) / 100).toFixed(2)
    };

    // 7. Breakdown by entry type
    console.log('\n[7] Ledger breakdown by entry type...');
    const entryTypeResult = await client.query(`
      SELECT
        entry_type,
        direction,
        COUNT(*) as count,
        SUM(amount_cents) as total_cents
      FROM ledger
      GROUP BY entry_type, direction
      ORDER BY entry_type, direction
    `);

    results.diagnostics.ledger_by_entry_type = entryTypeResult.rows.map(row => ({
      entry_type: row.entry_type,
      direction: row.direction,
      count: parseInt(row.count, 10),
      total_dollars: (row.total_cents / 100).toFixed(2)
    }));

    console.log('\n[8] Writing results to file...');
    const outputPath = path.join(__dirname, '..', '..', 'LEDGER_DIAGNOSTIC_RESULTS.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`✓ Results written to: ${outputPath}`);

    await client.end();
    console.log('\n✓ Diagnostics complete');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

runDiagnostics();
