// backend/scripts/syncUpcomingPGAContestsStandalone.js
const { Pool } = require('pg');
const crypto = require('crypto');

const ENTRY_FEES = [1000, 2000, 2500, 5000, 10000]; // $10, $20, $25, $50, $100
const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000043';

async function syncUpcomingPGAContests() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // STEP 1: Find upcoming platform PGA tournaments (real ESPN events only, SCHEDULED status)
    const allContestsRes = await client.query(
      `SELECT DISTINCT ON (ci.provider_event_id)
         ci.provider_event_id,
         ci.template_id,
         ci.tournament_start_time,
         ci.tournament_end_time,
         ci.lock_time,
         ci.contest_name
       FROM contest_instances ci
       JOIN contest_templates ct ON ci.template_id = ct.id
       WHERE ci.is_platform_owned = true
         AND ct.template_type = 'PGA_TOURNAMENT'
         AND ci.provider_event_id IS NOT NULL
         AND ci.provider_event_id LIKE 'espn_pga_%'
         AND ci.tournament_start_time > NOW()
         AND ci.status = 'SCHEDULED'
       ORDER BY ci.provider_event_id, ci.tournament_start_time`
    );

    if (allContestsRes.rows.length === 0) {
      throw new Error('No upcoming platform PGA contests found.');
    }

    console.log(`📋 Found ${allContestsRes.rows.length} upcoming PGA tournament(s)`);

    const createdContestIds = [];
    const failedTournaments = [];

    // STEP 2: Process each tournament event independently (per-tournament transaction)
    for (const baseContest of allContestsRes.rows) {
      console.log(`\n🏌️  Processing: ${baseContest.contest_name} (${baseContest.provider_event_id})`);

      const tournamentClient = await pool.connect();

      try {
        await tournamentClient.query('BEGIN');

        // Ensure this tournament's contests have proper times
        const updateRes = await tournamentClient.query(
          `UPDATE contest_instances
           SET tournament_start_time = $1,
               tournament_end_time   = $2,
               lock_time             = $3
           WHERE is_platform_owned = true
             AND provider_event_id = $4`,
          [
            baseContest.tournament_start_time,
            baseContest.tournament_end_time,
            baseContest.lock_time,
            baseContest.provider_event_id
          ]
        );
        console.log(`  ✓ Updated ${updateRes.rowCount} contest(s) with tournament times`);

        // STEP 3: Create all 5 entry-fee contests for this tournament
        for (const fee of ENTRY_FEES) {
          // Idempotency guard: check if this fee tier already exists for THIS template
          const existingRes = await tournamentClient.query(
            `SELECT id FROM contest_instances
             WHERE provider_event_id = $1
               AND template_id = $2
               AND entry_fee_cents = $3
               AND is_platform_owned = true
             LIMIT 1`,
            [baseContest.provider_event_id, baseContest.template_id, fee]
          );

          if (existingRes.rows.length > 0) {
            console.log(`    ⊘ Skipping $${(fee/100).toFixed(2)} (already exists)`);
            continue;
          }

          const newId = crypto.randomUUID();
          const contestName = `${baseContest.contest_name.split('$')[0].trim()} $${(fee/100).toFixed(0)}`;
          const joinToken = `stg_${crypto.randomBytes(16).toString('hex')}`;

          // 1. Insert contest instance
          const insertRes = await tournamentClient.query(
            `INSERT INTO contest_instances (
               id, template_id, organizer_id, entry_fee_cents,
               status, contest_name, tournament_start_time, tournament_end_time,
               lock_time, provider_event_id, max_entries,
               payout_structure, is_platform_owned, join_token, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                       '{"1":0.7,"2":0.3}'::jsonb,
                       $12,$13,NOW(),NOW())
             RETURNING id`,
            [
              newId,
              baseContest.template_id,
              PLATFORM_USER_ID,
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

          const contestInstanceId = insertRes.rows[0].id;

          // 2. Create tournament_configs row (required for field_selections FK)
          const tcRes = await tournamentClient.query(
            `INSERT INTO tournament_configs (
               id, contest_instance_id, provider_event_id, ingestion_endpoint,
               event_start_date, event_end_date, round_count, cut_after_round,
               leaderboard_schema_version, field_source, hash, published_at, is_active, created_at
             ) VALUES (
               gen_random_uuid(), $1, $2, '',
               $3, $4, 4, NULL,
               1, 'provider_sync', '', NOW(), false, NOW()
             )
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [contestInstanceId, baseContest.provider_event_id, baseContest.tournament_start_time, baseContest.tournament_end_time]
          );

          // Get tournament_config_id (either from insert or existing)
          let tourneyConfigId;
          if (tcRes.rows.length > 0) {
            tourneyConfigId = tcRes.rows[0].id;
          } else {
            const tcExistingRes = await tournamentClient.query(
              `SELECT id FROM tournament_configs WHERE contest_instance_id = $1`,
              [contestInstanceId]
            );
            if (tcExistingRes.rows.length > 0) {
              tourneyConfigId = tcExistingRes.rows[0].id;
            }
          }

          // 3. Create field_selections row with placeholder
          if (tourneyConfigId) {
            await tournamentClient.query(
              `INSERT INTO field_selections (
                 id, contest_instance_id, tournament_config_id, selection_json, created_at
               ) VALUES (gen_random_uuid(), $1, $2, $3, NOW())
               ON CONFLICT DO NOTHING`,
              [contestInstanceId, tourneyConfigId, JSON.stringify({ primary: [] })]
            );
          }

          // 4. Create lifecycle transition (SCHEDULED → SCHEDULED, SYSTEM triggered)
          await tournamentClient.query(
            `INSERT INTO contest_state_transitions (
               id, contest_instance_id, from_state, to_state, triggered_by, created_at
             ) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
            [contestInstanceId, 'SCHEDULED', 'SCHEDULED', 'SYSTEM']
          );

          createdContestIds.push(contestInstanceId);
          console.log(`    ✓ Created: ${contestName} ($${(fee/100).toFixed(0)})`);
        }

        await tournamentClient.query('COMMIT');
        console.log(`  ✅ Tournament committed successfully`);

      } catch (err) {
        await tournamentClient.query('ROLLBACK');
        console.error(`  ❌ Tournament failed: ${baseContest.provider_event_id}`);
        console.error(`  ${err.message}`);
        failedTournaments.push({
          provider_event_id: baseContest.provider_event_id,
          name: baseContest.contest_name,
          error: err.message
        });
      } finally {
        tournamentClient.release();
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ SYNC COMPLETE`);
    console.log(`Created ${createdContestIds.length} contest instances`);
    if (failedTournaments.length > 0) {
      console.log(`⚠️  ${failedTournaments.length} tournament(s) failed:`);
      failedTournaments.forEach(t => {
        console.log(`  - ${t.name} (${t.provider_event_id}): ${t.error}`);
      });
      console.log('='.repeat(60));
      process.exit(1);
    } else {
      console.log('='.repeat(60));
      process.exit(0);
    }

  } catch (err) {
    console.error('❌ Fatal error (pre-tournament processing):');
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  syncUpcomingPGAContests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { syncUpcomingPGAContests };
