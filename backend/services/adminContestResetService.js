/**
 * Admin Contest Reset Service
 *
 * One-time administrative operation to reset PGA contest environment.
 *
 * Operations:
 * 1. Identify existing platform PGA contest as template
 * 2. Refund all users from non-platform contests
 * 3. Cancel all non-platform contests
 * 4. Create 4 additional platform contests at different entry fee tiers
 * 5. Verify ledger integrity
 *
 * ALL OPERATIONS WRAPPED IN SINGLE TRANSACTION
 * Aborts on any error.
 */

const crypto = require('crypto');

// Platform system user ID (immutable across all environments)
const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';

/**
 * Main reset function
 *
 * @param {Object} pool - PostgreSQL connection pool
 * @returns {Promise<Object>} Summary with refundsIssued, contestsCancelled, systemContestsCreated
 */
async function resetPGAContestEnvironment(pool) {
  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Identify existing platform PGA contest
    console.log('\n📋 STEP 1: Locating existing platform PGA contest...');
    const baseContestResult = await client.query(
      `SELECT
         ci.id,
         ci.template_id,
         ci.entry_fee_cents,
         ci.provider_event_id,
         ci.lock_time,
         ci.tournament_start_time,
         ci.tournament_end_time,
         ci.payout_structure,
         ct.name as template_name
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.is_platform_owned = true
       AND ct.template_type = 'PGA_TOURNAMENT'
       LIMIT 1`
    );

    if (baseContestResult.rows.length === 0) {
      throw new Error(
        'No existing platform PGA contest found. Cannot determine template.'
      );
    }

    const baseContest = baseContestResult.rows[0];
    console.log(`✓ Found base contest: ${baseContest.id}`);
    console.log(`  Template ID: ${baseContest.template_id}`);
    console.log(`  Entry Fee: $${(baseContest.entry_fee_cents / 100).toFixed(2)}`);
    console.log(`  Template Name: ${baseContest.template_name}`);

    // STEP 2: Refund users from non-platform contests
    console.log('\n💰 STEP 2: Refunding users from non-platform contests...');

    const nonPlatformContestsResult = await client.query(
      `SELECT id, entry_fee_cents
       FROM contest_instances
       WHERE is_platform_owned = false`
    );

    let refundsIssued = 0;
    let totalRefundedCents = 0;

    for (const contest of nonPlatformContestsResult.rows) {
      // Find all participants in this contest
      const participantsResult = await client.query(
        `SELECT user_id FROM contest_participants
         WHERE contest_instance_id = $1`,
        [contest.id]
      );

      // Issue refund for each participant
      for (const participant of participantsResult.rows) {
        const idempotencyKey = `refund:${contest.id}:${participant.user_id}`;

        const refundResult = await client.query(
          `INSERT INTO ledger (
             user_id,
             entry_type,
             direction,
             amount_cents,
             reference_type,
             reference_id,
             idempotency_key,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            participant.user_id,
            'ENTRY_FEE_REFUND',
            'CREDIT',
            contest.entry_fee_cents,
            'CONTEST',
            contest.id,
            idempotencyKey
          ]
        );

        if (refundResult.rowCount === 1) {
          refundsIssued++;
          totalRefundedCents += contest.entry_fee_cents;
        }
      }
    }

    console.log(`✓ Refunds issued: ${refundsIssued}`);
    console.log(`✓ Total refunded: $${(totalRefundedCents / 100).toFixed(2)}`);

    // STEP 3: Cancel all non-platform contests
    console.log('\n🚫 STEP 3: Cancelling all non-platform contests...');

    const contestsToCancelResult = await client.query(
      `SELECT id, status FROM contest_instances
       WHERE is_platform_owned = false`
    );

    let contestsCancelled = 0;

    for (const contest of contestsToCancelResult.rows) {
      // Update contest status
      await client.query(
        `UPDATE contest_instances
         SET status = 'CANCELLED', updated_at = NOW()
         WHERE id = $1`,
        [contest.id]
      );

      // Record state transition
      await client.query(
        `INSERT INTO contest_state_transitions (
           contest_instance_id,
           from_state,
           to_state,
           triggered_by,
           reason
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          contest.id,
          contest.status || 'SCHEDULED',
          'CANCELLED',
          'ADMIN',
          'System reset to seed platform contests'
        ]
      );

      contestsCancelled++;
    }

    console.log(`✓ Contests cancelled: ${contestsCancelled}`);

    // STEP 4: Create 4 additional platform contests
    console.log('\n🎮 STEP 4: Creating 4 additional platform contests...');

    const entryFeesToCreate = [1000, 2000, 2500, 10000];
    const createdContestIds = [];

    // Check which entry fees already exist
    const existingFeesResult = await client.query(
      `SELECT DISTINCT entry_fee_cents
       FROM contest_instances
       WHERE is_platform_owned = true
       AND template_id = $1`,
      [baseContest.template_id]
    );

    const existingFees = new Set(
      existingFeesResult.rows.map(row => row.entry_fee_cents)
    );

    console.log(`  Existing platform contest fees: ${Array.from(existingFees)
      .map(f => `$${(f / 100).toFixed(2)}`)
      .join(', ')}`);

    const feeNameMap = {
      1000: '$10',
      2000: '$20',
      2500: '$25',
      10000: '$100'
    };

    for (const entryFee of entryFeesToCreate) {
      if (existingFees.has(entryFee)) {
        console.log(
          `  ⊘ Skipping entry fee $${(entryFee / 100).toFixed(2)} (already exists)`
        );
        continue;
      }

      const contestName = `${baseContest.template_name} ${feeNameMap[entryFee]}`;
      const newContestId = crypto.randomUUID();

      await client.query(
        `INSERT INTO contest_instances (
           id,
           template_id,
           organizer_id,
           entry_fee_cents,
           payout_structure,
           status,
           contest_name,
           tournament_start_time,
           tournament_end_time,
           lock_time,
           provider_event_id,
           max_entries,
           is_platform_owned,
           is_system_generated,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
        [
          newContestId,
          baseContest.template_id,
          PLATFORM_SYSTEM_USER_ID,
          entryFee,
          baseContest.payout_structure,
          'SCHEDULED',
          contestName,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          baseContest.provider_event_id,
          100, // max_entries
          true, // is_platform_owned
          false, // is_system_generated
        ]
      );

      createdContestIds.push(newContestId);
      console.log(
        `  ✓ Created: ${contestName} (${entryFee} cents, ID: ${newContestId})`
      );
    }

    console.log(`✓ Platform contests created: ${createdContestIds.length}`);

    // STEP 5: Verification query
    console.log('\n✅ STEP 5: Verification...');
    const verificationResult = await client.query(
      `SELECT
         entry_fee_cents,
         max_entries,
         COUNT(*) as contest_count
       FROM contest_instances
       WHERE is_platform_owned = true
       AND template_id = $1
       GROUP BY entry_fee_cents, max_entries
       ORDER BY entry_fee_cents`,
      [baseContest.template_id]
    );

    console.log('\nPlatform contests by entry fee:');
    for (const row of verificationResult.rows) {
      console.log(
        `  $${(row.entry_fee_cents / 100).toFixed(2)} (max_entries: ${row.max_entries}, count: ${row.contest_count})`
      );
    }

    // Verify ledger integrity (select only, no mutations)
    const ledgerCheckResult = await client.query(
      `SELECT
         entry_type,
         direction,
         COUNT(*) as count,
         SUM(amount_cents) as total_cents
       FROM ledger
       WHERE entry_type = 'ENTRY_FEE_REFUND'
       GROUP BY entry_type, direction`
    );

    console.log('\nLedger refunds recorded:');
    for (const row of ledgerCheckResult.rows) {
      console.log(
        `  ${row.entry_type} (${row.direction}): ${row.count} entries, total: $${(row.total_cents / 100).toFixed(2)}`
      );
    }

    // COMMIT transaction
    await client.query('COMMIT');
    console.log('\n✅ Transaction committed successfully\n');

    // Return summary
    return {
      refundsIssued,
      totalRefundedCents,
      contestsCancelled,
      systemContestsCreated: createdContestIds.length,
      createdContestIds,
      summary: {
        refundSummary: {
          contestsRefunded: nonPlatformContestsResult.rows.length,
          usersRefunded: refundsIssued,
          totalRefundedCents
        },
        cancellationSummary: {
          contestsCancelled
        },
        systemContestsSummary: {
          created: createdContestIds.length,
          entryFees: entryFeesToCreate
            .filter(f => !existingFees.has(f))
            .map(f => f)
        }
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(error.message);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  resetPGAContestEnvironment
};
