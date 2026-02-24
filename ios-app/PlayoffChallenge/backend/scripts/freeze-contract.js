const { Pool } = require('pg');
const crypto = require('crypto');
const { generateOpenAPISpec } = require('./generate-openapi');

async function freezeContract() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    // Generate the OpenAPI spec
    const spec = generateOpenAPISpec();
    const specJson = JSON.stringify(spec, null, 2);

    // Calculate SHA256 hash
    const hash = crypto.createHash('sha256').update(specJson).digest('hex');

    // Query for latest snapshot with contract_name = 'public-api'
    const result = await pool.query(
      'SELECT id, sha256 FROM api_contract_snapshots WHERE contract_name = $1 ORDER BY created_at DESC LIMIT 1',
      ['public-api']
    );

    const existingSnapshot = result.rows[0];

    if (!existingSnapshot) {
      // No existing snapshot, insert new one
      await pool.query(
        `INSERT INTO api_contract_snapshots (contract_name, version, sha256, spec_json)
         VALUES ($1, $2, $3, $4)`,
        ['public-api', 'v1', hash, JSON.stringify(spec)]
      );
      console.log('✓ Contract snapshot created');
      process.exit(0);
    }

    // Check if hash matches
    if (existingSnapshot.sha256 === hash) {
      console.log('✓ Contract matches frozen snapshot');
      process.exit(0);
    }

    // Hash mismatch
    console.error('✗ Contract hash mismatch');
    console.error(`Expected: ${existingSnapshot.sha256}`);
    console.error(`Got:      ${hash}`);
    process.exit(1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run when executed directly
if (require.main === module) {
  freezeContract();
}

module.exports = { freezeContract };
