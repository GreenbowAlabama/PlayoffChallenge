/**
 * PGA ESPN Ingestion — provider_final_flag Bug Fix Tests
 *
 * ROOT CAUSE: ingestWorkUnit() uses events[0] instead of finding the matching
 * event by providerEventId. When ESPN returns multiple events, code checks the
 * wrong event's status, causing provider_final_flag to always be false even when
 * the correct event has STATUS_FINAL.
 *
 * TEST-FIRST: Verify the bug exists, then verify the fix works.
 */

'use strict';

const { Pool } = require('pg');
const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');

describe('PGA ESPN Ingestion — provider_final_flag Event Matching', () => {
  let pool;
  let contestInstanceId;
  let userId;
  let templateId;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Create single test user for all tests
    const userResult = await pool.query(`
      INSERT INTO users (id, email, username)
      VALUES (gen_random_uuid(), 'test-pga-final-' || gen_random_uuid()::text || '@example.com', 'testuser')
      RETURNING id
    `);
    userId = userResult.rows[0].id;

    // Create template (once)
    const templateResult = await pool.query(`
      INSERT INTO contest_templates (
        id, name, sport, template_type, scoring_strategy_key,
        lock_strategy_key, settlement_strategy_key, default_entry_fee_cents,
        allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
        allowed_payout_structures, provider_tournament_id, season_year,
        is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        'Test PGA Template ' || gen_random_uuid()::text,
        'GOLF',
        'pga_tour',
        'pga_espn',
        'pga_lock',
        'pga_settlement',
        5000,
        1000,
        20000,
        '["50-50"]'::jsonb,
        'espn_pga_' || gen_random_uuid()::text,
        2026,
        false,
        NOW(),
        NOW()
      )
      RETURNING id
    `);
    templateId = templateResult.rows[0].id;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Create contest instance
    const contestResult = await pool.query(`
      INSERT INTO contest_instances (
        id, template_id, organizer_id, entry_fee_cents, payout_structure,
        status, max_entries, contest_name, provider_event_id,
        tournament_start_time, tournament_end_time, lock_time,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        5000,
        '{"structure": "50-50"}'::jsonb,
        'LIVE',
        20,
        'Test PGA Contest ' || gen_random_uuid()::text,
        'espn_pga_401811937',
        NOW() - INTERVAL '4 days',
        NOW() - INTERVAL '1 minute',
        NOW() - INTERVAL '4 days',
        NOW(),
        NOW()
      )
      RETURNING id
    `, [templateId, userId]);
    contestInstanceId = contestResult.rows[0].id;
  });

  afterEach(async () => {
    // Cleanup (delete in dependency order)
    await pool.query('DELETE FROM event_data_snapshots WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM golfer_event_scores WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM ingestion_events WHERE contest_instance_id = $1', [contestInstanceId]);
    await pool.query('DELETE FROM contest_instances WHERE id = $1', [contestInstanceId]);
  });

  it('should find the correct event by ID when ESPN returns multiple events', async () => {
    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      const ctx = {
        contestInstanceId,
        dbClient,
        providerEventId: 'espn_pga_401811937'
      };

      // ESPN returns multiple events. Our event (401811937) is FINAL, but events[0] (401811900) is SCHEDULED.
      // BUG: Old code checks events[0], sees SCHEDULED, sets flag to false.
      // FIX: New code should find event with id=401811937, see FINAL, set flag to true.
      const unit = {
        phase: 'SCORING',
        providerEventId: 'espn_pga_401811937',
        providerData: {
          events: [
            {
              id: '401811900', // Different event, earlier in array (SCHEDULED)
              status: {
                type: {
                  name: 'STATUS_SCHEDULED',
                  completed: false,
                  state: 'pre'
                }
              },
              competitions: [{
                competitors: [
                  {
                    id: '99999',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }]
            },
            {
              id: '401811937', // Our event - FINAL
              status: {
                type: {
                  name: 'STATUS_FINAL',
                  completed: true,
                  state: 'post'
                }
              },
              competitions: [{
                competitors: [
                  {
                    id: '12345',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }]
            }
          ]
        }
      };

      await pgaEspnIngestion.ingestWorkUnit(ctx, unit);

      // Verify: Should find the correct event and set provider_final_flag = true
      const snapshots = await dbClient.query(
        `SELECT provider_final_flag FROM event_data_snapshots
         WHERE contest_instance_id = $1
         ORDER BY ingested_at DESC
         LIMIT 1`,
        [contestInstanceId]
      );

      expect(snapshots.rows.length).toBeGreaterThan(0);
      expect(snapshots.rows[0].provider_final_flag).toBe(true); // Should be true for STATUS_FINAL event

      await dbClient.query('ROLLBACK');
    } finally {
      dbClient.release();
    }
  });

  it('should handle STATUS_SCHEDULED correctly', async () => {
    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      const ctx = {
        contestInstanceId,
        dbClient,
        providerEventId: 'espn_pga_401811937'
      };

      const unit = {
        phase: 'SCORING',
        providerEventId: 'espn_pga_401811937',
        providerData: {
          events: [{
            id: '401811937',
            status: {
              type: {
                name: 'STATUS_SCHEDULED',
                completed: false,
                state: 'pre'
              }
            },
            competitions: [{
              competitors: [
                {
                  id: '12345',
                  linescores: [
                    {
                      period: 1,
                      linescores: Array.from({ length: 18 }, (_, i) => ({
                        period: i + 1,
                        value: 4
                      }))
                    }
                  ]
                }
              ]
            }]
          }]
        }
      };

      await pgaEspnIngestion.ingestWorkUnit(ctx, unit);

      const snapshots = await dbClient.query(
        `SELECT provider_final_flag FROM event_data_snapshots
         WHERE contest_instance_id = $1
         ORDER BY ingested_at DESC
         LIMIT 1`,
        [contestInstanceId]
      );

      expect(snapshots.rows.length).toBeGreaterThan(0);
      expect(snapshots.rows[0].provider_final_flag).toBe(false);

      await dbClient.query('ROLLBACK');
    } finally {
      dbClient.release();
    }
  });

  it('should throw when ESPN event not found in response (invariant guard)', async () => {
    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      const ctx = {
        contestInstanceId,
        dbClient,
        providerEventId: 'espn_pga_401811937'
      };

      // ESPN returns events, but none match our event ID (401811937)
      // This tests the invariant guard: fail hard, don't silently use events[0]
      const unit = {
        phase: 'SCORING',
        providerEventId: 'espn_pga_401811937',
        providerData: {
          events: [
            {
              id: '401811900', // Different event, even if FINAL, should not be checked
              status: {
                type: {
                  name: 'STATUS_FINAL',
                  completed: true,
                  state: 'post'
                }
              },
              competitions: [{
                competitors: [
                  {
                    id: '12345',
                    linescores: [
                      {
                        period: 1,
                        linescores: Array.from({ length: 18 }, (_, i) => ({
                          period: i + 1,
                          value: 4
                        }))
                      }
                    ]
                  }
                ]
              }]
            }
          ]
        }
      };

      // Should throw with clear error message
      await expect(pgaEspnIngestion.ingestWorkUnit(ctx, unit))
        .rejects
        .toThrow(/ESPN ingestion invariant violation.*401811937.*not found in response/);

      // Verify no snapshot was created (ingestion failed)
      const snapshots = await dbClient.query(
        `SELECT COUNT(*) as count FROM event_data_snapshots
         WHERE contest_instance_id = $1`,
        [contestInstanceId]
      );

      expect(snapshots.rows[0].count).toBe('0'); // No snapshot on failure

      await dbClient.query('ROLLBACK');
    } finally {
      dbClient.release();
    }
  });
});
