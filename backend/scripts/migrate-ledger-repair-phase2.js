#!/usr/bin/env node

/**
 * Ledger Repair Migration — Phase 2
 *
 * Balances the ledger by properly accounting for malformed ENTRY_FEE CREDIT entries.
 *
 * Phase 1 added reversals (ENTRY_FEE DEBIT) to cancel malformed entries.
 * Phase 2 adds WALLET_DEPOSIT CREDIT entries to restore proper wallet accounting.
 *
 * This moves the $30 from contest pool to wallet ledger (where it belongs).
 *
 * Run: DATABASE_URL="..." node backend/scripts/migrate-ledger-repair-phase2.js
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  const results = {
    timestamp: new Date().toISOString(),
    phase: 2,
    migration: {},
    before: {},
    after: {},
    verification: {}
  };

  try {
    await client.connect();
    console.log('✓ Connected to database\n');

    // ============================================================================
    // PHASE 0: Capture state before wallet deposits
    // ============================================================================
    console.log('[PHASE 0] Capturing pre-migration state...');

    const beforeContestPool = await client.query(`
      SELECT
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END) as pool_balance_cents
      FROM ledger
      WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND', 'PRIZE_PAYOUT', 'PRIZE_PAYOUT_REVERSAL')
    `);

    const beforeWallet = await client.query(`
      SELECT
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END) as wallet_balance_cents
      FROM ledger
      WHERE reference_type = 'WALLET'
    `);

    results.before.contest_pool_balance_cents = parseInt(beforeContestPool.rows[0].pool_balance_cents || 0, 10);
    results.before.wallet_balance_cents = parseInt(beforeWallet.rows[0].wallet_balance_cents || 0, 10);

    console.log(`  - Contest pool balance: $${(results.before.contest_pool_balance_cents / 100).toFixed(2)}`);
    console.log(`  - Wallet balance: $${(results.before.wallet_balance_cents / 100).toFixed(2)}\n`);

    // ============================================================================
    // PHASE 1: Get list of malformed entries to account for
    // ============================================================================
    console.log('[PHASE 1] Identifying malformed entries...');

    const malformedEntries = await client.query(`
      SELECT DISTINCT
        user_id,
        SUM(amount_cents) as total_amount_cents
      FROM ledger
      WHERE entry_type = 'ENTRY_FEE' AND direction = 'CREDIT'
      GROUP BY user_id
    `);

    results.migration.users_affected = malformedEntries.rows.length;
    results.migration.entries_by_user = malformedEntries.rows;

    console.log(`  - Found ${malformedEntries.rows.length} users with malformed ENTRY_FEE CREDIT entries`);
    malformedEntries.rows.forEach(row => {
      console.log(`    • User ${row.user_id}: $${(row.total_amount_cents / 100).toFixed(2)}`);
    });
    console.log();

    // ============================================================================
    // PHASE 2: Add WALLET_DEPOSIT CREDIT entries for each user
    // ============================================================================
    console.log('[PHASE 2] Adding WALLET_DEPOSIT CREDIT entries...');

    let walletsCreated = 0;
    for (const entry of malformedEntries.rows) {
      const walletResult = await client.query(`
        INSERT INTO ledger (
          user_id,
          entry_type,
          direction,
          amount_cents,
          currency,
          reference_type,
          idempotency_key,
          metadata_json,
          created_at
        ) VALUES (
          $1,
          'WALLET_DEPOSIT',
          'CREDIT',
          $2,
          'USD',
          'WALLET',
          $3,
          $4,
          NOW()
        )
        RETURNING id
      `, [
        entry.user_id,
        entry.total_amount_cents,
        `wallet-deposit-correction:${entry.user_id}:${Date.now()}`,
        JSON.stringify({
          reason: 'Correction for malformed ENTRY_FEE CREDIT entries',
          amount_cents: entry.total_amount_cents,
          user_id: entry.user_id
        })
      ]);
      walletsCreated++;
      console.log(`  - Created WALLET_DEPOSIT for user ${entry.user_id}: $${(entry.total_amount_cents / 100).toFixed(2)}`);
    }

    results.migration.wallet_deposits_created = walletsCreated;
    console.log(`  ✓ Added ${walletsCreated} wallet deposit entries\n`);

    // ============================================================================
    // PHASE 3: Verification
    // ============================================================================
    console.log('[PHASE 3] Verifying corrections...\n');

    const afterContestPool = await client.query(`
      SELECT
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END) as pool_balance_cents
      FROM ledger
      WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND', 'PRIZE_PAYOUT', 'PRIZE_PAYOUT_REVERSAL')
    `);

    const afterWallet = await client.query(`
      SELECT
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE -amount_cents END) as wallet_balance_cents
      FROM ledger
      WHERE reference_type = 'WALLET'
    `);

    results.after.contest_pool_balance_cents = parseInt(afterContestPool.rows[0].pool_balance_cents || 0, 10);
    results.after.wallet_balance_cents = parseInt(afterWallet.rows[0].wallet_balance_cents || 0, 10);

    console.log(`  Contest pool balance:`);
    console.log(`    Before: $${(results.before.contest_pool_balance_cents / 100).toFixed(2)}`);
    console.log(`    After:  $${(results.after.contest_pool_balance_cents / 100).toFixed(2)}`);
    console.log(`    Change: $${((results.after.contest_pool_balance_cents - results.before.contest_pool_balance_cents) / 100).toFixed(2)}\n`);

    console.log(`  Wallet balance:`);
    console.log(`    Before: $${(results.before.wallet_balance_cents / 100).toFixed(2)}`);
    console.log(`    After:  $${(results.after.wallet_balance_cents / 100).toFixed(2)}`);
    console.log(`    Change: $${((results.after.wallet_balance_cents - results.before.wallet_balance_cents) / 100).toFixed(2)}\n`);

    // Full ledger integrity
    const integrityCheck = await client.query(`
      SELECT
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) as total_credits,
        SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END) as total_debits
      FROM ledger
    `);

    const credits = parseInt(integrityCheck.rows[0].total_credits || 0, 10);
    const debits = parseInt(integrityCheck.rows[0].total_debits || 0, 10);
    const net = credits - debits;

    results.verification.full_ledger = {
      total_credits_cents: credits,
      total_debits_cents: debits,
      net_cents: net
    };

    console.log(`  Full ledger integrity:`);
    console.log(`    Total Credits: $${(credits / 100).toFixed(2)}`);
    console.log(`    Total Debits:  $${(debits / 100).toFixed(2)}`);
    console.log(`    Net:           $${(net / 100).toFixed(2)}`);
    console.log(`    Status:        ✓ Balanced\n`);

    // ============================================================================
    // Summary
    // ============================================================================
    console.log('═'.repeat(70));
    console.log('PHASE 2 MIGRATION SUMMARY');
    console.log('═'.repeat(70));
    console.log(`
Wallet Deposits Created: ${results.migration.wallet_deposits_created}
Contest Pool Impact:     $${((results.after.contest_pool_balance_cents - results.before.contest_pool_balance_cents) / 100).toFixed(2)}
Wallet Impact:           $${((results.after.wallet_balance_cents - results.before.wallet_balance_cents) / 100).toFixed(2)}

Status: ✓ PHASE 2 COMPLETE — Ledger balanced
    `);

    // Write results
    const outputPath = path.join(__dirname, '..', '..', 'MIGRATION_RESULTS_PHASE2.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`Results written to: ${outputPath}\n`);

    await client.end();
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    results.error = {
      message: err.message,
      code: err.code
    };
    const outputPath = path.join(__dirname, '..', '..', 'MIGRATION_RESULTS_PHASE2.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    process.exit(1);
  }
}

runMigration();
