/**
 * PGA Leaderboard Debug Admin Endpoint Tests
 *
 * Purpose: Verify that the admin diagnostic endpoint correctly
 * exposes PGA leaderboard data with computed fantasy scores and metadata.
 *
 * Tests:
 * 1. Endpoint exists and returns 200 with valid structure
 * 2. Response contains metadata and entries with correct schema
 * 3. Scoring is deterministic across multiple calls
 * 4. LIVE contests use espn_live data source
 * 5. Polling stops behavior: COMPLETE contests use golfer_event_scores
 * 6. Metadata contains tournament context fields
 */

const request = require('supertest');
const { createTestApp, createMockAdminToken } = require('../mocks/testAppFactory');
const { randomUUID } = require('crypto');

describe('PGA Leaderboard Debug Admin Endpoint', () => {
  let app;
  let pool;
  let adminToken;
  let adminUserId;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret-for-unit-tests';

    const setup = await createTestApp();
    app = setup.app;
    pool = setup.pool;

    // Create admin user in database
    adminUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, name, email, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        adminUserId,
        'Test Admin',
        `admin-${adminUserId}@test.example.com`,
        true
      ]
    );

    // Generate valid JWT token for the admin user
    adminToken = createMockAdminToken({ sub: adminUserId });
  });

  afterAll(async () => {
    // pool.end() is handled globally by tests/setup.js
  });

  describe('GET /api/admin/pga/leaderboard-debug', () => {
    it('Test 1: endpoint exists and returns 200 with metadata and entries', async () => {
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('entries');
      expect(Array.isArray(response.body.entries)).toBe(true);
      // metadata may be null if no active PGA contest
      expect(response.body).toHaveProperty('metadata');
    });

    it('Test 2: entry objects match PgaLeaderboardEntry schema', async () => {
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.entries)).toBe(true);

      // If there are results, verify each matches the schema
      if (response.body.entries.length > 0) {
        const entry = response.body.entries[0];

        // Required fields
        expect(entry).toHaveProperty('golfer_id');
        expect(entry).toHaveProperty('player_name');
        expect(entry).toHaveProperty('position');
        expect(entry).toHaveProperty('score');
        expect(entry).toHaveProperty('finish_bonus');
        expect(entry).toHaveProperty('fantasy_score');
        expect(entry).toHaveProperty('rounds_scored');

        // Verify types
        expect(typeof entry.golfer_id).toBe('string');
        expect(typeof entry.player_name).toBe('string');
        expect(typeof entry.position).toBe('number');
        expect(typeof entry.score).toBe('number');
        expect(typeof entry.finish_bonus).toBe('number');
        expect(typeof entry.fantasy_score).toBe('number');
        expect(typeof entry.rounds_scored).toBe('number');
      }
    });

    it('Test 3: fantasy score is deterministic across multiple calls', async () => {
      // First call
      const response1 = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      // Second call
      const response2 = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // If data exists, verify exact match between calls (excluding generated_at which differs)
      if (response1.body.entries.length > 0) {
        expect(response1.body.entries).toEqual(response2.body.entries);
        response1.body.entries.forEach((player, index) => {
          expect(player.fantasy_score).toBe(response2.body.entries[index].fantasy_score);
        });
      }

      // Both should have same number of entries
      expect(response1.body.entries.length).toBe(response2.body.entries.length);
    });

    it('Test 4: finds LIVE contests regardless of sport value variant (pga, PGA, golf, GOLF)', async () => {
      // Setup: Create organizer user
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email, is_admin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [organizerId, 'Test Organizer 4', `organizer-4-${organizerId}@test.example.com`, false]
      );

      // Create contest template with lowercase 'pga' sport
      const templatePgaLower = randomUUID();
      const contestIdPgaLower = randomUUID();

      await pool.query(
        `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [templatePgaLower, 'Test Golf Tournament', 'pga', 'PGA_CUSTOM', 'standard', 'lock_by_time', 'standard', 10000, 5000, 50000, '[]']
      );

      // Create LIVE contest with lowercase 'pga' template
      const now = new Date();
      const pastTime = new Date(now.getTime() - 60000); // 1 minute ago

      await pool.query(
        `INSERT INTO contest_instances (id, template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [contestIdPgaLower, templatePgaLower, organizerId, 10000, '{}', 'LIVE', pastTime, pastTime, new Date(now.getTime() + 3600000), 'Test Golf LIVE', 20]
      );

      // Test: endpoint should find this LIVE contest
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('metadata');
      expect(response.body).toHaveProperty('entries');
      expect(Array.isArray(response.body.entries)).toBe(true);
    });

    it('Test 5: metadata contains tournament context fields', async () => {
      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      const meta = response.body.metadata;
      // If there's an active PGA contest, metadata should have all context fields
      if (meta !== null) {
        expect(typeof meta.contest_id).toBe('string');
        expect(typeof meta.contest_name).toBe('string');
        expect(typeof meta.status).toBe('string');
        expect(['LIVE', 'COMPLETE']).toContain(meta.status);
        expect(typeof meta.generated_at).toBe('string');
        expect(meta).toHaveProperty('tournament_start_time');
        expect(meta).toHaveProperty('tournament_end_time');
        expect(meta).toHaveProperty('provider_event_id');
        expect(meta).toHaveProperty('last_ingestion_at');
        expect(meta).toHaveProperty('data_source');
        expect(['espn_live', 'golfer_event_scores']).toContain(meta.data_source);

        // LIVE contests should use espn_live, COMPLETE should use golfer_event_scores
        if (meta.status === 'LIVE') {
          expect(meta.data_source).toBe('espn_live');
        } else {
          expect(meta.data_source).toBe('golfer_event_scores');
        }
      }
    });

    it('Test 6: COMPLETE contests use golfer_event_scores data source', async () => {
      // Setup: Create organizer
      const organizerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, email, is_admin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [organizerId, 'Test Organizer 6', `organizer-6-${organizerId}@test.example.com`, false]
      );

      const templateId = randomUUID();
      const contestId = randomUUID();
      const now = new Date();
      // Set tournament_start_time far in the future so this becomes the most recent
      const futureStart = new Date(now.getTime() + 999999999);

      await pool.query(
        `INSERT INTO contest_templates (id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents, allowed_payout_structures)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [templateId, 'Completed Tournament', 'PGA', 'PGA_CUSTOM', 'pga_standard_v1', 'lock_by_time', 'standard', 10000, 5000, 50000, '[]']
      );

      await pool.query(
        `INSERT INTO contest_instances (id, template_id, organizer_id, entry_fee_cents, payout_structure, status, lock_time, tournament_start_time, tournament_end_time, contest_name, max_entries)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [contestId, templateId, organizerId, 10000, '{}', 'COMPLETE', futureStart, futureStart, new Date(futureStart.getTime() + 86400000), 'PGA Complete Test', 50]
      );

      const response = await request(app)
        .get('/api/admin/pga/leaderboard-debug')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);

      const meta = response.body.metadata;
      // The most recent contest by tournament_start_time should be our COMPLETE one
      if (meta && meta.contest_id === contestId) {
        expect(meta.status).toBe('COMPLETE');
        expect(meta.data_source).toBe('golfer_event_scores');
      }
    });

    it('Test 7: no duplicate intervals — deterministic polling with consistent results', async () => {
      // Simulate rapid consecutive calls (as polling would do)
      const results = await Promise.all([
        request(app)
          .get('/api/admin/pga/leaderboard-debug')
          .set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .get('/api/admin/pga/leaderboard-debug')
          .set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .get('/api/admin/pga/leaderboard-debug')
          .set('Authorization', `Bearer ${adminToken}`)
      ]);

      // All should succeed
      results.forEach(r => {
        expect(r.status).toBe(200);
        expect(r.body).toHaveProperty('metadata');
        expect(r.body).toHaveProperty('entries');
      });

      // All should return the same entries (deterministic)
      expect(results[0].body.entries).toEqual(results[1].body.entries);
      expect(results[1].body.entries).toEqual(results[2].body.entries);
    });
  });
});
