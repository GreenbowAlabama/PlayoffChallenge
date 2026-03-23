/**
 * PGA Settlement Payouts Test
 *
 * Objective: Verify settlement payouts are created and ledger entries are written
 * - Create contest with entry_fee > 0
 * - Insert participants
 * - Insert scoring results
 * - Trigger settlement
 * - Assert: payouts > 0, ledger entries exist, contest_pools = 0
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { transitionLiveToComplete } = require('../../services/contestLifecycleService');

jest.setTimeout(90000);

const testEmail = (label = 'user') =>
  `${label}-${crypto.randomUUID()}@test.com`;

describe('PGA Settlement Payouts', () => {
  let pool;
  let contestId;
  let templateId;
  let organizerId;
  let createdUserIds = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_TEST) {
      throw new Error('DATABASE_URL_TEST must be set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      max: 3
    });
    const testConn = await pool.connect();
    await testConn.query('SELECT 1');
    testConn.release();
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    contestId = crypto.randomUUID();
    templateId = crypto.randomUUID();
    organizerId = crypto.randomUUID();

    // Create organizer
    await pool.query(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      [organizerId, testEmail('organizer')]
    );
    createdUserIds.push(organizerId);

    // Create template
    await pool.query(
      `INSERT INTO contest_templates
       (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key,
        settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
        allowed_entry_fee_max_cents, allowed_payout_structures, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
      [
        templateId,
        'Payout Test Template',
        'golf',
        'playoff',
        'pga_standard_v1',
        'golf_lock',
        'pga_standard_v1',
        10000,
        0,
        1000000,
        JSON.stringify({ '1': 60, '2': 40 })
      ]
    );

    // Create contest with past tournament_end_time (so settlement can trigger)
    const now = new Date();
    const pastEndTime = new Date(now.getTime() - 60000); // 1 minute ago

    await pool.query(
      `INSERT INTO contest_instances
       (id, template_id, organizer_id, contest_name, status, max_entries,
        lock_time, tournament_start_time, tournament_end_time, entry_fee_cents,
        payout_structure)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        contestId,
        templateId,
        organizerId,
        'Test Contest',
        'LIVE',
        100,
        new Date(now.getTime() - 7200000),
        new Date(now.getTime() - 3600000),
        pastEndTime,
        10000,
        JSON.stringify({ '1': 60, '2': 40 })
      ]
    );
  });

  afterEach(async () => {
    // Cleanup
    try {
      await pool.query('DELETE FROM ledger WHERE contest_instance_id = $1 OR user_id = ANY($2::uuid[])',
        [contestId, createdUserIds]);
      await pool.query('DELETE FROM settlement_records WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_state_transitions WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM event_data_snapshots WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM leaderboard_snapshots WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_participants WHERE contest_instance_id = $1', [contestId]);
      await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestId]);
      await pool.query('DELETE FROM contest_templates WHERE id = $1', [templateId]);
      for (const userId of createdUserIds) {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
    createdUserIds = [];
  });

  it('should create payouts > 0 and write ledger entries for settled contest', async () => {
    // Create 3 participants with entry fees
    const userIds = [];
    for (let i = 0; i < 3; i++) {
      const userId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO users (id, email) VALUES ($1, $2)',
        [userId, testEmail(`participant${i}`)]
      );
      userIds.push(userId);
      createdUserIds.push(userId);

      // Create participant entry
      await pool.query(
        `INSERT INTO contest_participants
         (contest_instance_id, user_id)
         VALUES ($1, $2)`,
        [contestId, userId]
      );

      // Create wallet deposit to fund participant
      await pool.query(
        `INSERT INTO ledger
         (id, user_id, entry_type, direction, amount_cents, currency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), userId, 'WALLET_DEPOSIT', 'CREDIT', 100000, 'USD']
      );

      // Create entry fee debit
      await pool.query(
        `INSERT INTO ledger
         (id, user_id, contest_instance_id, entry_type, direction, amount_cents, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          userId,
          contestId,
          'ENTRY_FEE',
          'DEBIT',
          10000,
          'USD'
        ]
      );
    }

    // Create final snapshot (required for settlement)
    const snapshotId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO event_data_snapshots
       (id, contest_instance_id, provider_event_id, payload, snapshot_hash, provider_final_flag)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshotId,
        contestId,
        'test_provider_event_id',
        JSON.stringify({ test: 'payload' }),
        'test_hash_123',
        true
      ]
    );

    // Create leaderboard scores (required for settlement payout calculation)
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO leaderboard_snapshots
         (id, contest_instance_id, user_id, rank, score)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          crypto.randomUUID(),
          contestId,
          userIds[i],
          i + 1,
          100 - i * 10
        ]
      );
    }

    // Verify initial state
    const beforePayouts = await pool.query(
      'SELECT COUNT(*) as count FROM payout_transfers WHERE contest_instance_id = $1',
      [contestId]
    );
    console.log('Before settlement: payout_transfers count =', beforePayouts.rows[0].count);

    const beforePoolQuery = await pool.query(
      `SELECT SUM(CASE WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents
                   WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN -amount_cents
                   ELSE 0 END) as pool
       FROM ledger WHERE contest_instance_id = $1`,
      [contestId]
    );
    const beforePool = beforePoolQuery.rows[0].pool || 0;
    console.log('Before settlement: contest_pools =', beforePool);

    // Trigger settlement by transitioning LIVE → COMPLETE
    const now = new Date();
    const result = await transitionLiveToComplete(pool, now);
    console.log('Settlement result:', result);

    // Verify settlement record was created
    const settlementRecs = await pool.query(
      'SELECT COUNT(*) as count FROM settlement_records WHERE contest_instance_id = $1',
      [contestId]
    );
    console.log('Settlement records:', settlementRecs.rows[0].count);

    // Verify payouts were created (payout_transfers table)
    const afterPayouts = await pool.query(
      'SELECT COUNT(*) as count, SUM(amount_cents) as total FROM payout_transfers WHERE contest_instance_id = $1',
      [contestId]
    );
    console.log('After settlement: payout_transfers count =', afterPayouts.rows[0].count, 'total =', afterPayouts.rows[0].total);
    expect(afterPayouts.rows[0].count).toBeGreaterThan(0);
    expect(afterPayouts.rows[0].total || 0).toBeGreaterThan(0);

    // Verify ledger entries exist (PRIZE_PAYOUT)
    const ledgerPayouts = await pool.query(
      `SELECT COUNT(*) as count, SUM(
         CASE WHEN direction = 'CREDIT' THEN amount_cents
              WHEN direction = 'DEBIT' THEN -amount_cents
              ELSE 0 END
       ) as total
       FROM ledger WHERE contest_instance_id = $1 AND entry_type = 'PRIZE_PAYOUT'`,
      [contestId]
    );
    const payoutLedgerCount = ledgerPayouts.rows[0].count || 0;
    const payoutLedgerTotal = ledgerPayouts.rows[0].total || 0;
    console.log('After settlement: ledger PRIZE_PAYOUT count =', payoutLedgerCount, 'total =', payoutLedgerTotal);
    expect(payoutLedgerCount).toBeGreaterThan(0);
    expect(payoutLedgerTotal).toBeGreaterThan(0);

    // Verify contest_pools returns close to 0 (entry fees minus payouts)
    const afterPoolQuery = await pool.query(
      `SELECT SUM(CASE WHEN entry_type = 'ENTRY_FEE' AND direction = 'DEBIT' THEN amount_cents
                   WHEN entry_type = 'ENTRY_FEE_REFUND' AND direction = 'CREDIT' THEN -amount_cents
                   WHEN entry_type = 'PRIZE_PAYOUT' AND direction = 'CREDIT' THEN -amount_cents
                   ELSE 0 END) as pool
       FROM ledger WHERE contest_instance_id = $1`,
      [contestId]
    );
    const afterPool = afterPoolQuery.rows[0].pool || 0;
    console.log('After settlement: contest_pools =', afterPool);
    expect(afterPool).toBe(0);
  });
});
