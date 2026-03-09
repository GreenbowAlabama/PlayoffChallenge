require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const { getUserOpsSnapshot } = require('../../services/userOpsService');

async function writeOutput(filename, serverTime, metrics) {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, filename);
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        server_time: serverTime,
        source: 'database',
        metrics
      },
      null,
      2
    )
  );

  console.log('Validation complete.');
  console.log(`Output written to: ${outputFile}`);
}

async function main() {
  const client = await pool.connect();
  try {
    const serverTimeResult = await client.query('SELECT NOW() as server_time');
    const serverTime = serverTimeResult.rows[0].server_time;
    const snapshot = await getUserOpsSnapshot(pool);
    await writeOutput('user-ops.expected.json', serverTime, snapshot);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
