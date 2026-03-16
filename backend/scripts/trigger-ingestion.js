#!/usr/bin/env node

/**
 * Manual Ingestion Trigger
 *
 * Usage: node trigger-ingestion.js <eventId>
 *
 * Fetches ESPN data for a specific event and triggers ingestion
 * for all contests using that event.
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const espnPgaApi = require('../services/ingestion/espn/espnPgaApi');
const { pollAndIngest } = require('../services/ingestion/orchestrators/pgaEspnPollingOrchestrator');

const eventId = process.argv[2];

if (!eventId) {
  console.error('Usage: node trigger-ingestion.js <eventId>');
  console.error('Example: node trigger-ingestion.js 401811937');
  process.exit(1);
}

async function triggerIngestion() {
  // Use test database if running in test mode
  const connectionString = process.env.TEST_DB_ALLOW_DBNAME === 'railway'
    ? process.env.DATABASE_URL_TEST
    : process.env.DATABASE_URL;

  const pool = new Pool({
    connectionString,
  });

  try {
    console.log(`[Ingestion Trigger] Fetching ESPN data for event ${eventId}...`);

    // Fetch event leaderboard from ESPN
    const leaderboard = await espnPgaApi.fetchLeaderboard({ eventId });

    if (!leaderboard.events || leaderboard.events.length === 0) {
      console.error(`[ERROR] No events found in leaderboard for ${eventId}`);
      process.exit(1);
    }

    console.log(`[Ingestion Trigger] Found event in leaderboard. Fetching all contests using this event...`);

    // Find all contests using this event
    const contestResult = await pool.query(
      `SELECT id FROM contest_instances
       WHERE provider_event_id = $1
       ORDER BY created_at ASC`,
      [`espn_pga_${eventId}`]
    );

    if (contestResult.rows.length === 0) {
      console.error(`[ERROR] No contests found for event espn_pga_${eventId}`);
      process.exit(1);
    }

    const contestIds = contestResult.rows.map(r => r.id);
    console.log(`[Ingestion Trigger] Found ${contestIds.length} contests using this event:`);
    contestIds.forEach(id => console.log(`  - ${id}`));

    // Prepare work unit
    const workUnit = {
      providerEventId: `espn_pga_${eventId}`,
      providerData: leaderboard
    };

    // Trigger ingestion for each contest
    console.log(`\n[Ingestion Trigger] Triggering ingestion for ${contestIds.length} contests...`);

    let successCount = 0;
    let errorCount = 0;

    for (const contestId of contestIds) {
      try {
        console.log(`\n[Ingestion] Processing contest ${contestId}...`);
        const result = await pollAndIngest(contestId, pool, [workUnit]);

        if (result.success) {
          console.log(`[Ingestion] ✓ SUCCESS: ${contestId}`);
          console.log(`  Summary: ${JSON.stringify(result.summary)}`);
          successCount++;
        } else {
          console.error(`[Ingestion] ✗ FAILED: ${contestId}`);
          errorCount++;
        }
      } catch (err) {
        console.error(`[Ingestion] ✗ ERROR for ${contestId}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n[Ingestion Trigger] Complete!`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Failed: ${errorCount}`);

    if (errorCount === 0) {
      console.log(`\n[Ingestion Trigger] All contests ingested successfully!`);
    }

  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

triggerIngestion();
