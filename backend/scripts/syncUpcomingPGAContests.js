/**
 * syncUpcomingPGAContests.js
 *
 * Ensures THE PLAYERS Championship contests exist for $10, $20, $25, $50, $100 tiers,
 * aligned with tournament times and joinable in the app.
 *
 * Usage:
 *   node backend/scripts/syncUpcomingPGAContests.js
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000043'; // platform_system

async function syncUpcomingPGAContests() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔒 Transaction started');

    // STEP 1: Find base upcoming contest
    const { rows: baseRows } = await client.query(
      `SELECT *
       FROM contest_instances
       WHERE is_platform_owned = true
         AND contest_name ILIKE '%THE PLAYERS Championship%'
       ORDER BY tournament_start_time
       LIMIT 1`
    );

    if (baseRows.length === 0) throw new Error('No upcoming platform PGA contest found.');

    const baseContest = baseRows[0];
    console.log(`📋 Upcoming base contest found: ${baseContest.id} (${baseContest.contest_name})`);

    // STEP 1.5: Resolve correct template
    const { rows: baseTemplateRows } = await client.query(
      `SELECT id, provider_tournament_id, season_year
       FROM contest_templates
       WHERE id = $1`,
      [baseContest.template_id]
    );

    if (baseTemplateRows.length === 0) {
      throw new Error(`Base contest template not found: ${baseContest.template_id}`);
    }

    const baseTemplate = baseTemplateRows[0];
    const { provider_tournament_id, season_year } = baseTemplate;

    const { rows: templateRows } = await client.query(
      `SELECT id
       FROM contest_templates
       WHERE provider_tournament_id = $1
         AND season_year = $2
       LIMIT 1`,
      [provider_tournament_id, season_year]
    );

    if (templateRows.length === 0) {
      throw new Error(`No template found for provider_tournament_id: ${provider_tournament_id}, season_year: ${season_year}`);
    }

    const correctTemplateId = templateRows[0].id;
    console.log(`🔧 Resolved template ${correctTemplateId} for tournament ${provider_tournament_id} (${season_year})`);

    // UPDATED TIERS
    const entryFeesToCreate = [1000, 2000, 2500, 5000, 10000]; // $10, $20, $25, $50, $100

    const createdContestIds = [];

    for (const fee of entryFeesToCreate) {
      const { rows: existingRows } = await client.query(
        `SELECT id, join_token
         FROM contest_instances
         WHERE is_platform_owned = true
           AND template_id = $1
           AND entry_fee_cents = $2
           AND status IN ('SCHEDULED','LOCKED','LIVE','COMPLETE')
         LIMIT 1`,
        [correctTemplateId, fee]
      );

      if (existingRows.length > 0) {
        const existingContest = existingRows[0];

        if (!existingContest.join_token) {
          const token = `stg_${crypto.randomUUID().replace(/-/g, '')}`;

          await client.query(
            `UPDATE contest_instances
             SET join_token = $1, updated_at = NOW()
             WHERE id = $2`,
            [token, existingContest.id]
          );

          console.log(`  ⊘ Updated $${(fee / 100).toFixed(0)} (ID: ${existingContest.id})`);
        } else {
          console.log(`  ⊘ Already exists $${(fee / 100).toFixed(0)} (ID: ${existingContest.id})`);
        }

        continue;
      }

      const newId = crypto.randomUUID();
      const joinToken = `stg_${crypto.randomUUID().replace(/-/g, '')}`;

      const payoutStructure = baseContest.payout_structure;

      const result = await client.query(
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
           max_entries,
           is_platform_owned,
           is_system_generated,
           provider_event_id,
           join_token,
           created_at,
           updated_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           'SCHEDULED',
           $6,
           $7,
           $8,
           $9,
           100,
           true,
           true,
           $10,
           $11,
           NOW(),
           NOW()
         )
         ON CONFLICT (provider_event_id, template_id, entry_fee_cents)
         WHERE provider_event_id IS NOT NULL
         DO NOTHING`,
        [
          newId,
          correctTemplateId,
          PLATFORM_USER_ID,
          fee,
          payoutStructure,
          `THE PLAYERS Championship $${(fee / 100).toFixed(0)}`,
          baseContest.tournament_start_time,
          baseContest.tournament_end_time,
          baseContest.lock_time,
          baseContest.provider_event_id,
          joinToken
        ]
      );

      if (result.rowCount === 0) {
        console.log(`  ⊘ Already exists: THE PLAYERS Championship $${(fee / 100).toFixed(0)}`);
      } else {
        createdContestIds.push(newId);
        console.log(`  ✓ Created: THE PLAYERS Championship $${(fee / 100).toFixed(0)}`);
      }
    }

    await client.query('COMMIT');

    console.log('✅ Transaction committed successfully');
    console.log('Created contest IDs:', createdContestIds);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back due to error:');
    console.error(err);
  } finally {
    client.release();
  }
}

syncUpcomingPGAContests()
  .then(() => {
    console.log('🎉 Script completed successfully');
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Script failed:', err);
    pool.end().catch(() => {});
    process.exit(1);
  });