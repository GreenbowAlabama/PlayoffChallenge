#!/usr/bin/env node
/**
 * Find Entries Source
 *
 * Determine where entries actually live and why entries_count = 0.
 * READ-ONLY diagnostic — no mutations.
 *
 * Usage:
 *   TEST_DB_ALLOW_DBNAME=railway node backend/debug/findEntriesSource.js > /tmp/entries_audit.json
 */

const { Pool } = require('pg');

const CONTEST_ID = '141a31f5-c28f-4d4a-b246-4016819450ef';

// Helper: Get all tables that reference contest_id or contest_instance_id
async function getTablesWithContestReference(pool) {
  try {
    const res = await pool.query(`
      SELECT DISTINCT table_name
      FROM information_schema.columns
      WHERE column_name IN ('contest_id', 'contest_instance_id')
      AND table_schema = 'public'
      ORDER BY table_name
    `);
    return res.rows.map(r => r.table_name);
  } catch (err) {
    return [];
  }
}

// Helper: Get column names for a table
async function getTableColumns(pool, tableName) {
  try {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [tableName]);
    return res.rows.map(r => r.column_name);
  } catch (err) {
    return [];
  }
}

// Helper: Detect which contest column exists
function getContestColumn(columns) {
  if (columns.includes('contest_instance_id')) return 'contest_instance_id';
  if (columns.includes('contest_id')) return 'contest_id';
  return null;
}

// Helper: Query table for contest rows
async function queryTableForContest(pool, tableName, contestColumn, contestId) {
  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) as count FROM ${tableName} WHERE ${contestColumn} = $1`,
      [contestId]
    );

    const count = parseInt(countRes.rows[0]?.count || 0);

    if (count === 0) {
      return { table: tableName, column: contestColumn, count: 0, sample: [] };
    }

    const sampleRes = await pool.query(
      `SELECT * FROM ${tableName} WHERE ${contestColumn} = $1 LIMIT 5`,
      [contestId]
    );

    return {
      table: tableName,
      column: contestColumn,
      count: count,
      sample: sampleRes.rows
    };
  } catch (err) {
    return { table: tableName, column: contestColumn, count: 0, sample: [], error: err.message };
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
    tables_with_contest_reference: [],
    tables_with_rows: [],
    entry_rosters_analysis: {
      count: 0,
      contest_ids_found: [],
      contest_instance_ids_found: [],
      mismatch_detected: false
    },
    diagnosis: null,
    next_step: null
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // 1. SCAN ALL TABLES FOR CONTEST REFERENCE
    // ════════════════════════════════════════════════════════════════════

    console.error('Scanning for tables with contest references...');
    const allTablesWithContestRef = await getTablesWithContestReference(pool);
    output.tables_with_contest_reference = allTablesWithContestRef;

    // ════════════════════════════════════════════════════════════════════
    // 2. CHECK LIKELY TABLES FIRST
    // ════════════════════════════════════════════════════════════════════

    const likelyTables = [
      'entries',
      'contest_entries',
      'user_entries',
      'lineup_entries',
      'entry',
      'contest_entry'
    ];

    console.error('Checking likely tables...');
    for (const tableName of likelyTables) {
      const columns = await getTableColumns(pool, tableName);
      if (columns.length === 0) continue;

      const contestColumn = getContestColumn(columns);
      if (!contestColumn) continue;

      const result = await queryTableForContest(pool, tableName, contestColumn, CONTEST_ID);
      if (result.count > 0) {
        output.tables_with_rows.push(result);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. SCAN ALL DISCOVERED TABLES
    // ════════════════════════════════════════════════════════════════════

    console.error('Scanning all discovered tables...');
    for (const tableName of allTablesWithContestRef) {
      // Skip if already checked in likely tables
      if (likelyTables.includes(tableName)) continue;

      const columns = await getTableColumns(pool, tableName);
      if (columns.length === 0) continue;

      const contestColumn = getContestColumn(columns);
      if (!contestColumn) continue;

      const result = await queryTableForContest(pool, tableName, contestColumn, CONTEST_ID);
      if (result.count > 0) {
        output.tables_with_rows.push(result);
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. CROSS-CHECK ENTRY_ROSTERS LINKAGE
    // ════════════════════════════════════════════════════════════════════

    console.error('Analyzing entry_rosters...');
    try {
      const countRes = await pool.query(
        `SELECT COUNT(*) as count FROM entry_rosters WHERE contest_instance_id = $1`,
        [CONTEST_ID]
      );
      output.entry_rosters_analysis.count = parseInt(countRes.rows[0].count);

      if (output.entry_rosters_analysis.count > 0) {
        // Get all contest_ids in entry_rosters for this contest
        const contestIdsRes = await pool.query(
          `SELECT DISTINCT contest_instance_id FROM entry_rosters WHERE contest_instance_id = $1`,
          [CONTEST_ID]
        );
        output.entry_rosters_analysis.contest_instance_ids_found = contestIdsRes.rows.map(r => r.contest_instance_id);

        // Check if entry_rosters references a different contest_id column (unlikely but check)
        const columns = await getTableColumns(pool, 'entry_rosters');
        if (columns.includes('contest_id')) {
          const otherConIdsRes = await pool.query(
            `SELECT DISTINCT contest_id FROM entry_rosters WHERE contest_instance_id = $1`,
            [CONTEST_ID]
          );
          output.entry_rosters_analysis.contest_ids_found = otherConIdsRes.rows.map(r => r.contest_id);
        }
      }
    } catch (err) {
      // entry_rosters table may not exist
    }

    // ════════════════════════════════════════════════════════════════════
    // 5. DIAGNOSIS
    // ════════════════════════════════════════════════════════════════════

    if (output.tables_with_rows.length === 0) {
      output.diagnosis = 'NO entries found in any table for this contest_id';
      output.next_step = 'Contest may not have any participants, or entries were deleted';
    } else if (output.tables_with_rows.some(t => t.table.includes('entries'))) {
      output.diagnosis = `Entries found in table(s): ${output.tables_with_rows.filter(t => t.table.includes('entries')).map(t => t.table).join(', ')}`;
      output.next_step = 'Cross-reference entries with entry_rosters to identify schema mismatch';
    } else {
      output.diagnosis = `Data found in: ${output.tables_with_rows.map(t => t.table).join(', ')}`;
      output.next_step = 'Investigate schema — entries may be stored under different table name';
    }

  } catch (err) {
    console.error('ERROR:', err.message);
    output.diagnosis = `ERROR: ${err.message}`;
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
