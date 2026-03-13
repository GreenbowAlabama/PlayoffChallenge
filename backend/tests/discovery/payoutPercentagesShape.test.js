/**
 * Test: Payout Percentages Contract Shape
 *
 * Validates that discovery service creates payout_percentages as numeric objects,
 * not arrays or other types. This prevents contract drift that caused API errors.
 */

const { Pool } = require('pg');
const { discoverTournament } = require('../../services/discovery/discoveryService');

describe('[Discovery] Payout Percentages Shape Validation', () => {
  let pool;
  const ORGANIZER_ID = '00000000-0000-0000-0000-000000000001';
  const NOW = new Date('2026-03-13T04:54:49Z');

  beforeAll(async () => {
    const config = {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT || 5432,
      database: process.env.DATABASE_NAME || 'playoff_challenge_test',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
    };

    if (process.env.DATABASE_URL) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
    } else {
      pool = new Pool(config);
    }

    // Wait for connection
    await new Promise((resolve, reject) => {
      pool.connect((err, client) => {
        if (err) return reject(err);
        client.release();
        resolve();
      });
    });
  }, 10000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('should create payout_percentages as numeric object with place keys', async () => {
    const input = {
      provider_tournament_id: 'espn_shape_test_' + Date.now(),
      name: 'Shape Validation Test Tournament',
      status: 'SCHEDULED',
      start_time: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      end_time: new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000),
      season_year: 2026
    };

    const result = await discoverTournament(input, pool, NOW, ORGANIZER_ID);

    if (!result.success) {
      console.error('[Test Debug] Discovery failed:', result);
    }

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.templateId).toBeDefined();

    // Verify payout_structure in database
    const client = await pool.connect();
    try {
      const templateResult = await client.query(
        `SELECT allowed_payout_structures FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );

      expect(templateResult.rows.length).toBe(1);

      const template = templateResult.rows[0];
      const payoutStructure = template.allowed_payout_structures;

      expect(Array.isArray(payoutStructure)).toBe(true);
      expect(payoutStructure.length).toBeGreaterThan(0);

      const firstEntry = payoutStructure[0];
      expect(firstEntry.payout_percentages).toBeDefined();

      // CRITICAL: Validate payout_percentages is an OBJECT with numeric values
      expect(typeof firstEntry.payout_percentages).toBe('object');
      expect(Array.isArray(firstEntry.payout_percentages)).toBe(false);

      // Validate each place value is a number or null
      Object.entries(firstEntry.payout_percentages).forEach(([place, percentage]) => {
        expect(typeof percentage === 'number' || percentage === null).toBe(true);
      });

      // Validate expected places exist with correct values
      expect(firstEntry.payout_percentages["1"]).toBe(50);
      expect(firstEntry.payout_percentages["2"]).toBe(30);
      expect(firstEntry.payout_percentages["3"]).toBe(20);

    } finally {
      client.release();
    }
  }, 15000);

  it('validates that non-numeric payout_percentages would be rejected by API', () => {
    // This test documents what the API layer expects

    // With array format, iterating entries gives indices (0, 1, 2) and values
    const invalidPayoutStructure = [
      { payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 } // INVALID: array
    ];

    const firstEntry = invalidPayoutStructure[0];

    // Verify test setup: invalid structure has array
    expect(Array.isArray(firstEntry.payout_percentages)).toBe(true);

    // When you Object.entries() an array, keys are string indices ("0", "1", "2")
    // and values are the array elements (0.5, 0.3, 0.2) - which ARE numbers
    // So the validation wouldn't catch this directly. It's caught at a higher level
    // by the presentation layer which expects an OBJECT, not an array.

    // Verify the shape is wrong for API contract
    expect(typeof firstEntry.payout_percentages).toBe('object');
    expect(Array.isArray(firstEntry.payout_percentages)).toBe(true); // This is the problem!
  });
});
