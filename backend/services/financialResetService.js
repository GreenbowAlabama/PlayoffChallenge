/**
 * Financial Reset Service
 *
 * Admin operations for resetting staging financial state.
 * Uses compensating ledger entries (append-only, no mutations).
 *
 * Governance:
 * - Ledger immutability: all corrections via ADJUSTMENT entries
 * - Idempotency: running twice produces same result
 * - All entries tagged with ADMIN_RESET or ADMIN_SEED reference types
 */

const { v5: uuidv5 } = require('uuid');
const NAMESPACE = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Reset financial state by inserting compensating ledger entries.
 * Neutralizes wallet liability and contest pool balances via ADJUSTMENT entries.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { success, wallet_reset_cents, contest_pool_reset_cents }
 */
async function resetFinancialState(pool) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const LedgerRepository = require('../repositories/LedgerRepository');

    // Calculate wallet liability
    const walletResult = await client.query(`
      SELECT COALESCE(
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents ELSE 0 END),
        0
      ) as balance_cents
      FROM ledger
      WHERE entry_type IN ('WALLET_DEPOSIT', 'WALLET_WITHDRAWAL', 'WALLET_WITHDRAWAL_REVERSAL', 'WALLET_DEBIT')
    `);
    const walletCents = parseInt(walletResult.rows[0].balance_cents || 0, 10);

    // Calculate contest pool balance
    const poolResult = await client.query(`
      SELECT COALESCE(
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents WHEN direction = 'DEBIT' THEN -amount_cents ELSE 0 END),
        0
      ) as balance_cents
      FROM ledger
      WHERE entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_REFUND')
    `);
    const poolCents = parseInt(poolResult.rows[0].balance_cents || 0, 10);

    // Insert wallet reset entry
    if (walletCents > 0) {
      const walletKey = 'reset-wallet-liability';
      const existing = await LedgerRepository.findByIdempotencyKey(client, walletKey);
      if (!existing) {
        const refId = uuidv5(walletKey, NAMESPACE);
        await LedgerRepository.insertLedgerEntry(client, {
          entry_type: 'ADJUSTMENT',
          direction: 'DEBIT',
          amount_cents: walletCents,
          currency: 'USD',
          reference_type: 'ADMIN_RESET',
          reference_id: refId,
          idempotency_key: walletKey,
          metadata_json: { operation: 'wallet_reset', original_cents: walletCents }
        });
      }
    }

    // Insert pool reset entry
    if (poolCents > 0) {
      const poolKey = 'reset-contest-pools';
      const existing = await LedgerRepository.findByIdempotencyKey(client, poolKey);
      if (!existing) {
        const refId = uuidv5(poolKey, NAMESPACE);
        await LedgerRepository.insertLedgerEntry(client, {
          entry_type: 'ADJUSTMENT',
          direction: 'DEBIT',
          amount_cents: poolCents,
          currency: 'USD',
          reference_type: 'ADMIN_RESET',
          reference_id: refId,
          idempotency_key: poolKey,
          metadata_json: { operation: 'pool_reset', original_cents: poolCents }
        });
      }
    }

    await client.query('COMMIT');
    return { success: true, wallet_reset_cents: walletCents, contest_pool_reset_cents: poolCents };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Seed test wallets with $100 each.
 * Identifies test users (email LIKE '%test%') and inserts WALLET_DEPOSIT entries.
 * Idempotent: running twice does not double-seed.
 *
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} { users_seeded, total_seeded_cents }
 */
async function seedTestWallets(pool) {
  const client = await pool.connect();
  const seedAmount = 10000; // $100

  try {
    await client.query('BEGIN');

    const testUsersResult = await client.query(`
      SELECT id, email FROM users WHERE LOWER(email) LIKE '%test%' ORDER BY created_at DESC
    `);
    const testUsers = testUsersResult.rows || [];

    const LedgerRepository = require('../repositories/LedgerRepository');
    let seeded = 0;
    let total = 0;

    for (const user of testUsers) {
      const key = `seed-wallet-${user.id}`;
      const existing = await LedgerRepository.findByIdempotencyKey(client, key);
      if (!existing) {
        const refId = uuidv5(key, NAMESPACE);
        await LedgerRepository.insertLedgerEntry(client, {
          user_id: user.id,
          entry_type: 'WALLET_DEPOSIT',
          direction: 'CREDIT',
          amount_cents: seedAmount,
          currency: 'USD',
          reference_type: 'ADMIN_SEED',
          reference_id: refId,
          idempotency_key: key,
          metadata_json: { operation: 'test_seed', user_email: user.email }
        });
        seeded++;
        total += seedAmount;
      }
    }

    await client.query('COMMIT');
    return { users_seeded: seeded, total_seeded_cents: total };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  resetFinancialState,
  seedTestWallets
};
