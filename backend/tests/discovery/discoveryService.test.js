/**
 * Discovery Service Tests
 *
 * Integration tests for tournament discovery and system template creation.
 * Verifies idempotency, metadata freeze, and race condition handling.
 */

const { Pool } = require('pg');
const { discoverTournament } = require('../../services/discovery/discoveryService');

describe('discoveryService', () => {
  let pool;
  const now = new Date('2026-03-01T12:00:00Z');

  const validInput = {
    provider_tournament_id: 'pga_test_2026',
    season_year: 2026,
    name: 'PGA Test Tournament 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'SCHEDULED'
  };

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Create a test user for contest instances
    const userId = '00000000-0000-0000-0000-000000000001';
    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, 'test-organizer@example.com', 'test-organizer']
    );
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query(
      `DELETE FROM contest_instances
       WHERE template_id IN (
         SELECT id FROM contest_templates
         WHERE provider_tournament_id LIKE 'pga_test_%'
       )`
    );
    await pool.query(
      `DELETE FROM contest_templates
       WHERE provider_tournament_id LIKE 'pga_test_%'`
    );
  });

  describe('template creation', () => {
    it('should create new system template on first discovery', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_masters_2026'
      };

      const result = await discoverTournament(testInput, pool, now);

      expect(result.success).toBe(true);
      expect(result.templateId).toBeTruthy();
      expect(result.created).toBe(true);
      expect(result.updated).toBe(false);
      expect(result.statusCode).toBe(201);

      // Verify template exists in database
      const template = await pool.query(
        `SELECT * FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );
      expect(template.rows).toHaveLength(1);
      expect(template.rows[0].is_system_generated).toBe(true);
      expect(template.rows[0].provider_tournament_id).toBe(testInput.provider_tournament_id);
      expect(template.rows[0].season_year).toBe(testInput.season_year);
    });

    it('should set template properties correctly', async () => {
      const result = await discoverTournament(validInput, pool, now);
      const template = await pool.query(
        `SELECT * FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );
      const row = template.rows[0];

      expect(row.name).toBe(validInput.name);
      expect(row.sport).toBe('pga');
      expect(row.template_type).toBe('daily');
      expect(row.scoring_strategy_key).toBe('stroke_play');
      expect(row.lock_strategy_key).toBe('auto_discovery');
      expect(row.settlement_strategy_key).toBe('pga_settlement');
      expect(row.default_entry_fee_cents).toBe(5000);
      expect(row.is_active).toBe(true);
    });

    it('should create template with correct payout structure', async () => {
      const result = await discoverTournament(validInput, pool, now);
      const template = await pool.query(
        `SELECT * FROM contest_templates WHERE id = $1`,
        [result.templateId]
      );
      const row = template.rows[0];

      const payouts = row.allowed_payout_structures;
      expect(Array.isArray(payouts)).toBe(true);
      expect(payouts.length).toBeGreaterThan(0);
      expect(payouts[0].payout_percentages).toEqual([0.5, 0.3, 0.2]);
    });
  });

  describe('idempotency', () => {
    it('should return same template on rediscovery', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_idempotent_2026'
      };

      const result1 = await discoverTournament(testInput, pool, now);
      expect(result1.success).toBe(true);
      expect(result1.created).toBe(true);

      const result2 = await discoverTournament(testInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.templateId).toBe(result1.templateId);
      expect(result2.created).toBe(false);
      expect(result2.updated).toBe(false);
      expect(result2.statusCode).toBe(200);
    });

    it('should update name if no locked instances exist', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_update_no_lock_2026'
      };

      // First discovery
      const result1 = await discoverTournament(testInput, pool, now);
      expect(result1.success).toBe(true);
      expect(result1.created).toBe(true);

      // Rediscover with updated name
      const updatedInput = {
        ...testInput,
        name: 'PGA Test Tournament 2026 (Updated)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.templateId).toBe(result1.templateId);
      expect(result2.created).toBe(false);
      expect(result2.updated).toBe(true);

      // Verify name was updated
      const template = await pool.query(
        `SELECT name FROM contest_templates WHERE id = $1`,
        [result1.templateId]
      );
      expect(template.rows[0].name).toBe(updatedInput.name);
    });

    it('should freeze metadata after LOCKED instance is created', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_freeze_locked_2026'
      };

      // Create template
      const result = await discoverTournament(testInput, pool, now);
      const templateId = result.templateId;

      // Create a LOCKED instance with real user
      const userId = '00000000-0000-0000-0000-000000000001';
      const contestResult = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'LOCKED',
          new Date(),
          'Test Contest',
          100
        ]
      );

      // Rediscover with updated name (SAME provider_tournament_id)
      const updatedInput = {
        ...testInput,
        name: 'PGA Test Tournament 2026 (Frozen)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.updated).toBe(false); // Should NOT update

      // Verify name was NOT changed
      const template = await pool.query(
        `SELECT name FROM contest_templates WHERE id = $1`,
        [templateId]
      );
      expect(template.rows[0].name).toBe(validInput.name); // Original name
    });

    it('should freeze metadata after LIVE instance', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_freeze_live_2026'
      };

      // Create template
      const result = await discoverTournament(testInput, pool, now);
      const templateId = result.templateId;

      // Create a LIVE instance with real user
      const userId = '00000000-0000-0000-0000-000000000001';
      await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'LIVE',
          new Date(),
          'Test Contest',
          100
        ]
      );

      // Rediscover with updated name (SAME provider_tournament_id)
      const updatedInput = {
        ...testInput,
        name: 'PGA Test Tournament 2026 (Frozen)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.updated).toBe(false); // Should NOT update
    });

    it('should freeze metadata after COMPLETE instance', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_freeze_complete_2026'
      };

      // Create template
      const result = await discoverTournament(testInput, pool, now);
      const templateId = result.templateId;

      // Create a COMPLETE instance with real user
      const userId = '00000000-0000-0000-0000-000000000001';
      await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'COMPLETE',
          new Date(),
          'Test Contest',
          100
        ]
      );

      // Rediscover with updated name (SAME provider_tournament_id)
      const updatedInput = {
        ...testInput,
        name: 'PGA Test Tournament 2026 (Frozen)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.updated).toBe(false); // Should NOT update
    });

    it('should allow update with SCHEDULED instances', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_allow_update_scheduled_2026'
      };

      // Create template
      const result = await discoverTournament(testInput, pool, now);
      const templateId = result.templateId;

      // Create a SCHEDULED instance (not terminal) with real user
      const userId = '00000000-0000-0000-0000-000000000001';
      await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, start_time, contest_name, max_entries
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          templateId,
          userId,
          5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2] }),
          'SCHEDULED',
          new Date(),
          'Test Contest',
          100
        ]
      );

      // Rediscover with updated name (SAME provider_tournament_id)
      const updatedInput = {
        ...testInput,
        name: 'PGA Test Tournament 2026 (Updated)'
      };
      const result2 = await discoverTournament(updatedInput, pool, now);

      expect(result2.success).toBe(true);
      expect(result2.updated).toBe(true); // SHOULD update
    });
  });

  describe('unique constraint enforcement', () => {
    it('should enforce partial unique index on (provider_tournament_id, season_year)', async () => {
      // Create first template
      const result1 = await discoverTournament(validInput, pool, now);
      expect(result1.success).toBe(true);

      // Try to manually insert duplicate system template
      const duplicateQuery = async () => {
        return pool.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key,
            lock_strategy_key, settlement_strategy_key,
            default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures,
            is_active, provider_tournament_id, season_year, is_system_generated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            'Duplicate',
            'pga',
            'daily',
            'stroke_play',
            'auto_discovery',
            'pga_settlement',
            5000,
            1000,
            50000,
            JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2] }]),
            true,
            validInput.provider_tournament_id,
            validInput.season_year,
            true
          ]
        );
      };

      // Should fail with unique constraint violation
      await expect(duplicateQuery()).rejects.toThrow();
    });

    it('should enforce unique constraint on system templates', async () => {
      // Create system template
      const result1 = await discoverTournament(validInput, pool, now);
      expect(result1.success).toBe(true);

      // Try to manually create another system template with same (provider_tournament_id, season_year)
      const duplicateQuery = async () => {
        return pool.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key,
            lock_strategy_key, settlement_strategy_key,
            default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures,
            is_active, provider_tournament_id, season_year, is_system_generated
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            'Duplicate System Template',
            'pga',
            'daily',
            'stroke_play',
            'auto_discovery',
            'pga_settlement',
            5000,
            1000,
            50000,
            JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2] }]),
            false, // Make it inactive to avoid unique_active_template_per_type violation
            validInput.provider_tournament_id,
            validInput.season_year,
            true // IS system-generated
          ]
        );
      };

      // Should fail with unique constraint violation
      await expect(duplicateQuery()).rejects.toThrow('unique');
    });
  });

  describe('validation error handling', () => {
    it('should reject invalid input', async () => {
      const result = await discoverTournament(
        { ...validInput, season_year: 1999 },
        pool,
        now
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SEASON_YEAR');
      expect(result.statusCode).toBe(400);
      expect(result.templateId).toBeNull();
    });

    it('should reject missing name', async () => {
      const result = await discoverTournament(
        { ...validInput, name: '' },
        pool,
        now
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MISSING_TOURNAMENT_NAME');
      expect(result.statusCode).toBe(400);
    });

    it('should reject invalid time range', async () => {
      const result = await discoverTournament(
        {
          ...validInput,
          start_time: new Date('2026-03-18T20:00:00Z'),
          end_time: new Date('2026-03-15T08:00:00Z')
        },
        pool,
        now
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_TIME_RANGE');
      expect(result.statusCode).toBe(400);
    });

    it('should reject tournament outside discovery window', async () => {
      const result = await discoverTournament(
        {
          ...validInput,
          start_time: new Date('2026-06-01T08:00:00Z'),
          end_time: new Date('2026-06-05T20:00:00Z')
        },
        pool,
        now
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('OUTSIDE_DISCOVERY_WINDOW');
      expect(result.statusCode).toBe(400);
    });
  });

  describe('determinism', () => {
    it('should be deterministic (same input → same output on repeated calls)', async () => {
      const testInput = {
        ...validInput,
        provider_tournament_id: 'pga_test_determinism_2026'
      };

      // First call: creates template
      const result1 = await discoverTournament(testInput, pool, now);
      expect(result1.created).toBe(true);

      // Second call: returns existing template
      const result2 = await discoverTournament(testInput, pool, now);
      expect(result2.created).toBe(false);

      // Both should return the same template ID
      expect(result1.templateId).toBe(result2.templateId);
      expect(result2.success).toBe(true);
    });

    it('should be replay-safe (injected now)', async () => {
      const fixedNow = new Date('2026-03-01T12:00:00Z');

      const result1 = await discoverTournament(validInput, pool, fixedNow);
      const result2 = await discoverTournament(validInput, pool, fixedNow);

      expect(result1.templateId).toBe(result2.templateId);
    });
  });
});
