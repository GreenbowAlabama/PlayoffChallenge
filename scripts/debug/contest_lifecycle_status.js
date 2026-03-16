#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const scriptName = path.basename(__filename, '.js');
const logFile = path.join(__dirname, `${scriptName}.log`);

// Redirect stdout to log file
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  logStream.write(args.join(' ') + '\n');
};

const run = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    originalLog('====================================');
    originalLog(scriptName);
    originalLog(`Generated: ${new Date().toISOString()}`);
    originalLog('====================================');
    originalLog('');

    const result = await pool.query(`
      SELECT
        id,
        contest_name,
        status,
        provider_event_id,
        lock_time,
        tournament_start_time,
        created_at
      FROM contest_instances
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    logStream.end();
  }
};

run();
