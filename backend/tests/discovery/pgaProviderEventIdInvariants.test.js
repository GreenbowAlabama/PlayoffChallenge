/**
 * PGA Provider Event ID Invariants Test
 *
 * Validates two critical invariants required for ingestion to work:
 *
 * Invariant 1: contest_instances.provider_event_id must equal tournament_configs.provider_event_id
 *              for the same contest_instance_id
 *              (ingestionService.initializeTournamentField uses tournament_configs.provider_event_id
 *               to determine which event to fetch for ingestion)
 *
 * Invariant 2: ESPN fetcher must return event with requested ID when present in scoreboard
 *              (if fetcher returns wrong event, lock_time derivation uses wrong data)
 */

'use strict';

const { Pool } = require('pg');

describe('PGA Provider Event ID Invariants', () => {
  let pool;
  const organizerId = '00000000-0000-0000-0000-000000000043';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    await pool.query(
      `INSERT INTO users (id, email, username) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [organizerId, 'test@platform.local', 'test-user']
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await pool.query(`DELETE FROM tournament_configs WHERE contest_instance_id IN (
      SELECT id FROM contest_instances WHERE provider_event_id LIKE 'espn_pga_invariant_%'
    )`);

    await pool.query(`DELETE FROM field_selections WHERE contest_instance_id IN (
      SELECT id FROM contest_instances WHERE provider_event_id LIKE 'espn_pga_invariant_%'
    )`);

    await pool.query(
      `DELETE FROM contest_instances WHERE provider_event_id LIKE 'espn_pga_invariant_%'`
    );

    await pool.query(
      `DELETE FROM contest_templates WHERE provider_tournament_id = 'espn_pga_invariant'
       AND is_system_generated = true`
    );
  });

  afterEach(() => {
    // Reset global.fetch to avoid cross-test contamination
    global.fetch = undefined;
  });

  describe('Invariant 1: tournament_configs.provider_event_id == contest_instances.provider_event_id', () => {
    it('should have matching provider_event_id in both tables for same contest_instance_id', async () => {
      // Create template
      const templateResult = await pool.query(
        `INSERT INTO contest_templates (
          name, sport, template_type, scoring_strategy_key, lock_strategy_key,
          settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
          allowed_entry_fee_max_cents, allowed_payout_structures,
          is_active, is_system_generated, status, provider_tournament_id, season_year
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          'test_template',
          'GOLF',
          'PGA_TOURNAMENT',
          'stroke_play',
          'auto_discovery',
          'pga_settlement',
          5000, 1000, 50000,
          JSON.stringify([{ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }]),
          false, true, 'SCHEDULED', 'espn_pga_invariant', 2026
        ]
      );

      const templateId = templateResult.rows[0].id;
      const testEventId = 'espn_pga_invariant_401811937';

      // Create contest instance with provider_event_id
      const instanceResult = await pool.query(
        `INSERT INTO contest_instances (
          template_id, organizer_id, entry_fee_cents, payout_structure,
          status, contest_name, lock_time, provider_event_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        RETURNING id, provider_event_id`,
        [
          templateId, organizerId, 5000,
          JSON.stringify({ payout_percentages: [0.5, 0.3, 0.2], min_entries: 2 }),
          'SCHEDULED', 'test_contest',
          new Date('2026-04-09T07:00:00Z'),
          testEventId
        ]
      );

      const contestInstanceId = instanceResult.rows[0].id;
      const instanceProviderId = instanceResult.rows[0].provider_event_id;

      // Initialize tournament field (creates tournament_configs)
      const { initializeTournamentField } = require('../../services/ingestionService');
      await initializeTournamentField(pool, contestInstanceId);

      // Verify tournament_configs exists and has matching provider_event_id
      const configResult = await pool.query(
        `SELECT contest_instance_id, provider_event_id
         FROM tournament_configs
         WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );

      expect(configResult.rows.length).toBe(1);
      const config = configResult.rows[0];

      // INVARIANT CHECK: tournament_configs.provider_event_id must equal contest_instances.provider_event_id
      expect(config.provider_event_id).toBe(instanceProviderId);
      expect(config.provider_event_id).toBe(testEventId);
    });
  });

  describe('Invariant 2: ESPN fetcher must return requested event when present in scoreboard', () => {
    it('should return event with requested ID when scoreboard contains it', async () => {
      const { fetchEspnSummary } = require('../../services/discovery/espnDataFetcher');

      // Mock scoreboard with multiple events
      const mockScoreboardResponse = {
        events: [
          {
            id: '401811935',
            name: 'Arnold Palmer Invitational',
            competitions: [
              {
                competitors: [
                  { startTime: '2026-03-17T14:00:00Z' }
                ]
              }
            ]
          },
          {
            id: '401811937',
            name: 'The Masters',
            competitions: [
              {
                competitors: [
                  { startTime: '2026-04-09T08:00:00Z' }
                ]
              }
            ]
          }
        ]
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockScoreboardResponse)
      });

      // Request second event
      const requestedId = '401811937';
      const result = await fetchEspnSummary(requestedId);

      expect(result).toBeDefined();
      expect(result.events).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);

      const returnedEventId = result.events[0].id;

      // INVARIANT CHECK: Must return the requested event, not first event
      // If this fails, lock_time derivation uses wrong event's data
      expect(returnedEventId).toBe(requestedId);
    });
  });
});
