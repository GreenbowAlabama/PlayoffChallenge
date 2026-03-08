/**
 * Contest Ops Service Tests
 *
 * Tests for operational snapshot aggregation:
 * - Contest retrieval
 * - Template data
 * - Tournament config scoping (event family vs all)
 * - Lifecycle transitions
 * - Snapshot health
 * - Error handling
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { Pool } = require('pg');
const { contestOpsService } = require('../../services/contestOpsService');

let pool;

describe('contestOpsService', () => {
  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      ssl: false,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('getContestOpsSnapshot', () => {
    it('should return contest not found error for non-existent contest', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(contestOpsService.getContestOpsSnapshot(pool, fakeId)).rejects.toThrow(
        /Contest not found/
      );
    });

    it('should return complete snapshot with all required fields', async () => {
      // Create test data
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES (
            'Test Template', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest', 20
          ) RETURNING id`,
          [templateId],
        );
        const contestId = contestRes.rows[0].id;

        // Create tournament config for this contest
        await client.query(
          `INSERT INTO tournament_configs (
            contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash
          ) VALUES (
            $1, 'espn_event_123', 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash123'
          )`,
          [contestId],
        );

        // Create lifecycle transition
        await client.query(
          `INSERT INTO contest_state_transitions (
            contest_instance_id, from_state, to_state, triggered_by, reason
          ) VALUES ($1, 'SCHEDULED', 'LOCKED', 'LOCK_TIME_REACHED', 'Time reached')`,
          [contestId],
        );

        // Create event snapshot
        await client.query(
          `INSERT INTO event_data_snapshots (
            contest_instance_id, snapshot_hash, provider_event_id,
            provider_final_flag, payload
          ) VALUES ($1, 'hash456', 'espn_event_123', false, '{}')`,
          [contestId],
        );

        await client.query('COMMIT');

        // Fetch snapshot
        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // Verify structure
        expect(snapshot).toHaveProperty('server_time');
        expect(snapshot).toHaveProperty('contest');
        expect(snapshot).toHaveProperty('template');
        expect(snapshot).toHaveProperty('template_contests');
        expect(snapshot).toHaveProperty('contest_tournament_config');
        expect(snapshot).toHaveProperty('tournament_configs');
        expect(snapshot).toHaveProperty('lifecycle');
        expect(snapshot).toHaveProperty('snapshot_health');

        // Verify contest data
        expect(snapshot.contest.id).toBe(contestId);
        expect(snapshot.contest.contest_name).toBe('Test Contest');
        expect(snapshot.contest.status).toBe('SCHEDULED');
        expect(snapshot.contest.entry_fee_cents).toBe(5000);

        // Verify template
        expect(snapshot.template.id).toBe(templateId);
        expect(snapshot.template.name).toBe('Test Template');

        // Verify tournament config shape
        expect(snapshot.contest_tournament_config).not.toBeNull();
        expect(snapshot.contest_tournament_config).toHaveProperty('id');
        expect(snapshot.contest_tournament_config).toHaveProperty('provider_event_id');
        expect(snapshot.contest_tournament_config).not.toBeInstanceOf(Array);

        // Verify lifecycle
        expect(snapshot.lifecycle.length).toBeGreaterThan(0);
        expect(snapshot.lifecycle[0].from_state).toBe('SCHEDULED');
        expect(snapshot.lifecycle[0].to_state).toBe('LOCKED');

        // Verify snapshot health
        expect(snapshot.snapshot_health.snapshot_count).toBe(1);
        expect(snapshot.snapshot_health.latest_snapshot).not.toBeNull();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should return null for contest_tournament_config when none exists', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES (
            'Test Template 2', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest without tournament config
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 2', 20
          ) RETURNING id`,
          [templateId],
        );
        const contestId = contestRes.rows[0].id;

        await client.query('COMMIT');

        // Fetch snapshot
        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // Verify contest_tournament_config is null, not array
        expect(snapshot.contest_tournament_config).toBeNull();
        expect(Array.isArray(snapshot.contest_tournament_config)).toBe(false);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should include updated_at in contest data', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES (
            'Test Template 3', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 3', 20
          ) RETURNING id`,
          [templateId],
        );
        const contestId = contestRes.rows[0].id;

        await client.query('COMMIT');

        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // Verify updated_at is present
        expect(snapshot.contest).toHaveProperty('updated_at');
        expect(snapshot.contest.updated_at).not.toBeNull();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should return empty snapshot_health when no snapshots exist', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES (
            'Test Template 4', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 4', 20
          ) RETURNING id`,
          [templateId],
        );
        const contestId = contestRes.rows[0].id;

        await client.query('COMMIT');

        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // Verify snapshot health with no snapshots
        expect(snapshot.snapshot_health.snapshot_count).toBe(0);
        expect(snapshot.snapshot_health.latest_snapshot).toBeNull();
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should scope tournament configs by provider_event_id when present', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures
          ) VALUES (
            'Test Template 5', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest with provider_event_id
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, '11111111-1111-1111-1111-111111111111', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5', 20, 'espn_event_456'
          ) RETURNING id`,
          [templateId],
        );
        const contestId = contestRes.rows[0].id;

        // Create tournament configs with different provider_event_ids
        await client.query(
          `INSERT INTO tournament_configs (
            contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash, is_active
          ) VALUES (
            $1, 'espn_event_456', 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash123', true
          )`,
          [contestId],
        );

        // Create another contest with same event_id
        const contest2Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, '22222222-2222-2222-2222-222222222222', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5B', 20, 'espn_event_456'
          ) RETURNING id`,
          [templateId],
        );
        const contest2Id = contest2Res.rows[0].id;

        await client.query(
          `INSERT INTO tournament_configs (
            contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash, is_active
          ) VALUES (
            $1, 'espn_event_456', 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash124', false
          )`,
          [contest2Id],
        );

        // Create config with different event_id (should be excluded)
        const contest3Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, '33333333-3333-3333-3333-333333333333', 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5C', 20, 'espn_event_789'
          ) RETURNING id`,
          [templateId],
        );
        const contest3Id = contest3Res.rows[0].id;

        await client.query(
          `INSERT INTO tournament_configs (
            contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash
          ) VALUES (
            $1, 'espn_event_789', 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash125'
          )`,
          [contest3Id],
        );

        await client.query('COMMIT');

        // Fetch snapshot for contest 1 (should only see configs for espn_event_456)
        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // All configs should be for espn_event_456
        expect(snapshot.tournament_configs.length).toBe(2);
        snapshot.tournament_configs.forEach((config) => {
          expect(config.provider_event_id).toBe('espn_event_456');
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});

module.exports = { contestOpsService };
