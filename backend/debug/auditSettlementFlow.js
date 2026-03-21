#!/usr/bin/env node
/**
 * Audit Settlement Flow
 *
 * Determine why a COMPLETE contest has NO payout_transfers.
 * READ-ONLY diagnostic — no mutations.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/auditSettlementFlow.js > /tmp/settlement_audit.json
 */

const { Pool } = require('pg');

const CONTEST_ID = '141a31f5-c28f-4d4a-b246-4016819450ef';

// Helper: Get column names for a table
async function getTableColumns(pool, tableName) {
  try {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [tableName]
    );
    return res.rows.map(r => r.column_name);
  } catch (err) {
    return [];
  }
}

// Helper: Check if column exists in a table
function hasColumn(columns, columnName) {
  return columns.includes(columnName);
}

// Helper: Safe query with fallback columns
async function queryTableByContestId(pool, tableName, columns, contestId) {
  try {
    // Determine which contest ID column to use
    let idColumn = null;
    if (hasColumn(columns, 'contest_instance_id')) {
      idColumn = 'contest_instance_id';
    } else if (hasColumn(columns, 'contest_id')) {
      idColumn = 'contest_id';
    } else {
      return [];
    }

    const query = `SELECT * FROM ${tableName} WHERE ${idColumn} = $1 LIMIT 10`;
    const res = await pool.query(query, [contestId]);
    return res.rows;
  } catch (err) {
    return [];
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5
  });

  const output = {
    schema_discovered: {},
    contest: null,
    entries_count: 0,
    entries_sample: [],
    rosters_count: 0,
    scoring_source: null,
    scoring_rows_found: 0,
    scoring_sample: [],
    payout_jobs: [],
    payout_transfers: [],
    wallet_tables_found: [],
    wallet_activity: [],
    diagnosis: null,
    settlement_status: null,
    next_step: null
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 0. DISCOVER SCHEMA
    // ════════════════════════════════════════════════════════════════════

    console.error('Discovering schema...');
    const tablesToCheck = [
      'contest_instances',
      'entries',
      'entry_rosters',
      'payout_jobs',
      'payout_transfers',
      'contest_scores',
      'leaderboard',
      'entry_scores'
    ];

    for (const tableName of tablesToCheck) {
      output.schema_discovered[tableName] = await getTableColumns(pool, tableName);
    }

    // ════════════════════════════════════════════════════════════════════
    // 1. FETCH CONTEST_INSTANCE
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching contest_instance...');
    if (output.schema_discovered.contest_instances.length === 0) {
      console.error('ERROR: contest_instances table not found');
      output.diagnosis = 'SCHEMA_ERROR: contest_instances table not found';
      console.log(JSON.stringify(output, null, 2));
      process.exit(1);
    }

    const contestRes = await pool.query(
      `SELECT * FROM contest_instances WHERE id = $1`,
      [CONTEST_ID]
    );

    if (contestRes.rows.length === 0) {
      console.error('ERROR: Contest not found');
      output.diagnosis = 'CONTEST_NOT_FOUND';
      console.log(JSON.stringify(output, null, 2));
      process.exit(1);
    }

    output.contest = contestRes.rows[0];

    // ════════════════════════════════════════════════════════════════════
    // 2. FETCH ENTRIES
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching entries...');
    if (output.schema_discovered.entries.length > 0) {
      let idColumn = 'contest_instance_id';
      if (!hasColumn(output.schema_discovered.entries, 'contest_instance_id') &&
          hasColumn(output.schema_discovered.entries, 'contest_id')) {
        idColumn = 'contest_id';
      }

      try {
        const entriesCountRes = await pool.query(
          `SELECT COUNT(*) as count FROM entries WHERE ${idColumn} = $1`,
          [CONTEST_ID]
        );
        output.entries_count = parseInt(entriesCountRes.rows[0].count);

        const entriesSampleRes = await pool.query(
          `SELECT * FROM entries WHERE ${idColumn} = $1 LIMIT 5`,
          [CONTEST_ID]
        );
        output.entries_sample = entriesSampleRes.rows;
      } catch (err) {
        output.entries_count = 0;
        output.entries_sample = [];
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. FETCH ENTRY_ROSTERS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching entry_rosters...');
    if (output.schema_discovered.entry_rosters.length > 0) {
      let idColumn = 'contest_instance_id';
      if (!hasColumn(output.schema_discovered.entry_rosters, 'contest_instance_id') &&
          hasColumn(output.schema_discovered.entry_rosters, 'contest_id')) {
        idColumn = 'contest_id';
      }

      try {
        const rostersCountRes = await pool.query(
          `SELECT COUNT(*) as count FROM entry_rosters WHERE ${idColumn} = $1`,
          [CONTEST_ID]
        );
        output.rosters_count = parseInt(rostersCountRes.rows[0].count);
      } catch (err) {
        output.rosters_count = 0;
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. FETCH SCORING DATA (CHECK ALL POSSIBLE TABLES)
    // ════════════════════════════════════════════════════════════════════

    console.error('Checking scoring tables...');

    const scoringTables = ['contest_scores', 'leaderboard', 'entry_scores'];
    let scoringFound = false;

    for (const tableName of scoringTables) {
      if (output.schema_discovered[tableName].length === 0) {
        continue;
      }

      let idColumn = 'contest_instance_id';
      if (!hasColumn(output.schema_discovered[tableName], 'contest_instance_id') &&
          hasColumn(output.schema_discovered[tableName], 'contest_id')) {
        idColumn = 'contest_id';
      }

      try {
        const checkRes = await pool.query(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE ${idColumn} = $1`,
          [CONTEST_ID]
        );

        const count = parseInt(checkRes.rows[0].count);
        if (count > 0) {
          output.scoring_source = tableName;
          output.scoring_rows_found = count;
          scoringFound = true;

          // Fetch sample rows
          const sampleRes = await pool.query(
            `SELECT * FROM ${tableName} WHERE ${idColumn} = $1 LIMIT 3`,
            [CONTEST_ID]
          );
          output.scoring_sample = sampleRes.rows;
          break;
        }
      } catch (err) {
        // Query failed, continue
      }
    }

    if (!scoringFound) {
      output.scoring_source = 'none';
    }

    // ════════════════════════════════════════════════════════════════════
    // 5. FETCH PAYOUT_JOBS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching payout_jobs...');
    if (output.schema_discovered.payout_jobs.length > 0) {
      output.payout_jobs = await queryTableByContestId(
        pool,
        'payout_jobs',
        output.schema_discovered.payout_jobs,
        CONTEST_ID
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 6. FETCH PAYOUT_TRANSFERS
    // ════════════════════════════════════════════════════════════════════

    console.error('Fetching payout_transfers...');
    if (output.schema_discovered.payout_transfers.length > 0) {
      output.payout_transfers = await queryTableByContestId(
        pool,
        'payout_transfers',
        output.schema_discovered.payout_transfers,
        CONTEST_ID
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 7. DETECT WALLET TABLE NAMES
    // ════════════════════════════════════════════════════════════════════

    console.error('Detecting wallet tables...');
    const walletTablesRes = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name ILIKE '%wallet%' AND table_schema = 'public'`
    );

    const walletTableNames = walletTablesRes.rows.map(r => r.table_name);
    output.wallet_tables_found = walletTableNames;

    // Query each wallet table for contest_id references
    for (const tableName of walletTableNames) {
      const columns = await getTableColumns(pool, tableName);

      // Try to find contest_id or contest_instance_id column
      let hasContestRef = false;
      let idColumn = null;

      if (hasColumn(columns, 'contest_instance_id')) {
        hasContestRef = true;
        idColumn = 'contest_instance_id';
      } else if (hasColumn(columns, 'contest_id')) {
        hasContestRef = true;
        idColumn = 'contest_id';
      }

      if (hasContestRef) {
        try {
          const walletRes = await pool.query(
            `SELECT * FROM ${tableName} WHERE ${idColumn} = $1 LIMIT 5`,
            [CONTEST_ID]
          );

          if (walletRes.rows.length > 0) {
            output.wallet_activity.push({
              table: tableName,
              rows_count: walletRes.rows.length,
              sample: walletRes.rows
            });
          }
        } catch (err) {
          // Query failed, skip
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 8. DIAGNOSIS
    // ════════════════════════════════════════════════════════════════════

    const contestStatus = output.contest?.status;
    const hasPayoutJobs = output.payout_jobs.length > 0;
    const hasPayoutTransfers = output.payout_transfers.length > 0;
    const hasScoring = output.scoring_source && output.scoring_source !== 'none';
    const hasEntries = output.entries_count > 0;
    const hasRosters = output.rosters_count > 0;

    // Determine settlement status
    if (contestStatus !== 'COMPLETE') {
      output.settlement_status = 'NOT_TRIGGERED';
      output.diagnosis = `Contest status is ${contestStatus}, not COMPLETE`;
      output.next_step = `Check why contest has not transitioned to COMPLETE`;
    } else if (!hasEntries) {
      output.settlement_status = 'BROKEN';
      output.diagnosis = 'COMPLETE contest has no entries';
      output.next_step = 'Investigate data integrity — entries may have been deleted or not created';
    } else if (!hasRosters) {
      output.settlement_status = 'BROKEN';
      output.diagnosis = 'COMPLETE contest has entries but no entry_rosters';
      output.next_step = 'Investigate data integrity — rosters may have been deleted';
    } else if (!hasScoring) {
      output.settlement_status = 'PARTIAL';
      output.diagnosis = 'Contest is COMPLETE but has no scoring data';
      output.next_step = 'Check scoring pipeline — pgaRosterScoringService may not have run';
    } else if (hasPayoutJobs && !hasPayoutTransfers) {
      output.settlement_status = 'PARTIAL';
      output.diagnosis = `Payout jobs created (${output.payout_jobs.length}) but no transfers executed`;
      output.next_step = 'Check payout_jobs for status/error — transfers may be pending or failed';
    } else if (!hasPayoutJobs && !hasPayoutTransfers) {
      output.settlement_status = 'PARTIAL';
      output.diagnosis = 'No payout_jobs or payout_transfers — settlement orchestration may not have run';
      output.next_step = 'Check if settlement executor/lifecycle engine triggered payout creation';
    } else if (hasPayoutTransfers) {
      output.settlement_status = 'COMPLETE';
      output.diagnosis = `Settlement complete: ${output.payout_transfers.length} transfers found`;
      output.next_step = 'Settlement flow appears normal';
    }

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    output.diagnosis = `ERROR: ${err.message}`;
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
