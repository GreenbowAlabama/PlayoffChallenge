/**
 * Fully Seed Upcoming PGA Contests (Platform)
 *
 * Creates 4 new platform PGA contests based on an existing one.
 * Generates join tokens, copies roster and payout info, sets timing, max entries.
 *
 * Usage:
 *   node backend/scripts/seedUpcomingPGAContestsFull.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043';

// Entry fees to seed
const ENTRY_FEES = [1000, 2000, 2500, 10000];
const MAX_ENTRIES = 100;

async function seedUpcomingPGAContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Locate base platform PGA contest
    const baseRes = await client.query(`
      SELECT *
      FROM contest_instances ci
      JOIN contest_templates ct ON ci.template_id = ct.id
      WHERE ci.is_platform_owned = true
        AND ct.template_type = 'PGA_TOURNAMENT'
      ORDER BY ci.tournament_start_time DESC
      LIMIT 1
    `);

    if (baseRes.rows.length === 0) {
      throw new Error('No existing platform PGA contest found to clone');
    }

    const base = baseRes.rows[0];
    console.log(`📋 Base contest found: ${base.id} (${base.contest_name})`);

    // STEP 2: Compute future timings
    const now = new Date();
    const tournamentStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const tournamentEnd = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days
    const lockTime = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000); // 6 days

    const createdIds = [];

    for (const fee of ENTRY_FEES) {
      const contestId = crypto.randomUUID();
      const joinToken = `stg_${crypto.randomUUID().replace(/-/g, '')}`;
      const contestName = `${base.contest_name.split('$')[0].trim()} $${(fee / 100).toFixed(0)}`;

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
          join_token,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        [
          contestId,
          base.template_id,
          PLATFORM_SYSTEM_USER_ID,
          fee,
          base.payout_structure,
          'SCHEDULED',
          contestName,
          tournamentStart,
          tournamentEnd,
          lockTime,
          base.provider_event_id,
          MAX_ENTRIES,
          true,
          true,
          joinToken
        ]
      );

      createdIds.push({ id: contestId, contestName, joinToken, entryFee: fee });
      console.log(`  ✓ Created: ${contestName} (ID: ${contestId}, joinToken: ${joinToken})`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contests:', createdIds);

    return createdIds;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedUpcomingPGAContests().catch(() => process.exit(1));
}

module.exports = { seedUpcomingPGAContests };