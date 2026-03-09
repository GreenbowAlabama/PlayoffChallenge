// backend/scripts/syncUpcomingPGAContestsStandalone.js
const { Pool } = require('pg');
const crypto = require('crypto');

async function syncUpcomingPGAContests() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Find upcoming platform PGA contest (base)
    const baseContestRes = await client.query(
      `SELECT ci.id, ci.template_id, ci.entry_fee_cents, ci.provider_event_id,
              ci.tournament_start_time, ci.tournament_end_time, ci.lock_time,
              ci.contest_name, ci.max_entries
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.is_platform_owned = true
         AND ct.template_type = 'PGA_TOURNAMENT'
         AND ci.tournament_start_time > NOW()
       ORDER BY ci.tournament_start_time
       LIMIT 1`
    );

    if (baseContestRes.rows.length === 0) {
      throw new Error('No upcoming platform PGA contest found.');
    }

    const baseContest = baseContestRes.rows[0];
    console.log(`📋 Upcoming base contest: ${baseContest.contest_name} (${baseContest.id})`);

    // STEP 2: Ensure all platform contests have proper tournament times
    const updateRes = await client.query(
      `UPDATE contest_instances
       SET tournament_start_time = $1,
           tournament_end_time   = $2,
           lock_time             = $3
       WHERE is_platform_owned = true
         AND template_id = $4`,
      [
        baseContest.tournament_start_time,
        baseContest.tournament_end_time,
        baseContest.lock_time,
        baseContest.template_id
      ]
    );
    console.log(`🟢 Updated ${updateRes.rowCount} platform PGA contests with tournament times`);

    // STEP 3: Create missing entry-fee contests ($10, $20, $25, $100)
    const entryFees = [1000, 2000, 2500, 10000];
    const existingFeesRes = await client.query(
      `SELECT DISTINCT entry_fee_cents
       FROM contest_instances
       WHERE is_platform_owned = true
         AND template_id = $1`,
      [baseContest.template_id]
    );
    const existingFees = new Set(existingFeesRes.rows.map(r => r.entry_fee_cents));

    const createdContestIds = [];

    for (const fee of entryFees) {
      if (existingFees.has(fee)) {
        console.log(`  ⊘ Skipping $${(fee/100).toFixed(2)} (already exists)`);
        continue;
      }

      const newId = crypto.randomUUID();
      const contestName = `${baseContest.contest_name.split('$')[0].trim()} $${(fee/100).toFixed(0)}`;

      const joinToken = `stg_${crypto.randomBytes(16).toString('hex')}`;

      await client.query(
        `INSERT INTO contest_instances (
           id, template_id, organizer_id, entry_fee_cents,
           status, contest_name, tournament_start_time, tournament_end_time,
           lock_time, provider_event_id, max_entries,
           is_platform_owned, join_token
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          newId,
          baseContest.template_id,
          '00000000-0000-0000-0000-000000000043', // platform_system
          fee,
          'SCHEDULED',
          contestName,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          baseContest.provider_event_id,
          100,
          true,
          joinToken
        ]
      );
      createdContestIds.push(newId);
      console.log(`  ✓ Created: ${contestName} (${fee} cents, ID: ${newId}, join_token: ${joinToken})`);
    }

    await client.query('COMMIT');
    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdContestIds);

    return createdContestIds;

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  syncUpcomingPGAContests().then(ids => console.log('🎯 Done.', ids));
}

module.exports = { syncUpcomingPGAContests };
