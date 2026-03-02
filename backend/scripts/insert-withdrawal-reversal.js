#!/usr/bin/env node

/**
 * Insert reversal ledger entry for a failed withdrawal
 *
 * Usage: WITHDRAWAL_ID=<uuid> node insert-withdrawal-reversal.js
 *
 * Example: WITHDRAWAL_ID=4900 node insert-withdrawal-reversal.js
 */

require('dotenv').config();

const { Pool } = require('pg');
const withdrawalId = process.env.WITHDRAWAL_ID;

if (!withdrawalId) {
  console.error('Error: WITHDRAWAL_ID environment variable is required');
  console.error('Usage: WITHDRAWAL_ID=<uuid> node insert-withdrawal-reversal.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function insertReversal() {
  const client = await pool.connect();

  try {
    // 1. Fetch withdrawal to verify it exists and get user_id + amount_cents
    const withdrawalResult = await client.query(
      `SELECT id, user_id, amount_cents, status
       FROM wallet_withdrawals
       WHERE id = $1 OR id::text = $1`,
      [withdrawalId]
    );

    if (withdrawalResult.rows.length === 0) {
      console.error(`Error: Withdrawal ${withdrawalId} not found`);
      process.exit(1);
    }

    const withdrawal = withdrawalResult.rows[0];
    console.log(`Found withdrawal: ${JSON.stringify(withdrawal, null, 2)}`);

    if (withdrawal.status !== 'FAILED') {
      console.warn(`Warning: Withdrawal status is '${withdrawal.status}', not 'FAILED'`);
    }

    // 2. Check if reversal already exists
    const reversalIdempotencyKey = `wallet_withdrawal_reversal:${withdrawal.id}`;
    const existingReversal = await client.query(
      `SELECT id FROM ledger WHERE idempotency_key = $1`,
      [reversalIdempotencyKey]
    );

    if (existingReversal.rows.length > 0) {
      console.log(`Reversal already exists for withdrawal ${withdrawal.id}`);
      process.exit(0);
    }

    // 3. Insert reversal ledger entry
    const reversalResult = await client.query(
      `INSERT INTO ledger (
         user_id, entry_type, direction, amount_cents, reference_type,
         reference_id, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, entry_type, direction, amount_cents, created_at`,
      [
        withdrawal.user_id,
        'WALLET_WITHDRAWAL_REVERSAL',
        'CREDIT',
        withdrawal.amount_cents,
        'WALLET',
        withdrawal.id,
        reversalIdempotencyKey
      ]
    );

    console.log(`✓ Reversal inserted:`);
    console.log(JSON.stringify(reversalResult.rows[0], null, 2));

    // 4. Verify wallet balance increased
    const balanceResult = await client.query(
      `SELECT COALESCE(
         SUM(CASE
           WHEN direction = 'CREDIT' THEN amount_cents
           WHEN direction = 'DEBIT' THEN -amount_cents
         END),
         0
       ) as balance_cents
       FROM ledger
       WHERE reference_type = 'WALLET'
       AND reference_id = $1`,
      [withdrawal.user_id]
    );

    console.log(`User ${withdrawal.user_id} wallet balance: ${balanceResult.rows[0].balance_cents} cents`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

insertReversal();
