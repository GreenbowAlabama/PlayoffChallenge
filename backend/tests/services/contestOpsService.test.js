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
const contestOpsService = require('../../services/contestOpsService');

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

        // Create user
        const userRes = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizerId = userRes.rows[0].id;

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template', 'PGA', 'test_type_1', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest', 20
          ) RETURNING id`,
          [templateId, organizerId],
        );
        const contestId = contestRes.rows[0].id;

        // Create tournament config for this contest
        await client.query(
          `INSERT INTO tournament_configs (
            id, contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash
          ) VALUES (
            gen_random_uuid(), $1, 'espn_event_123', 'https://espn.com/api',
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
        expect(snapshot.lifecycle.transitions.length).toBeGreaterThan(0);
        expect(snapshot.lifecycle.transitions[0].from_state).toBe('SCHEDULED');
        expect(snapshot.lifecycle.transitions[0].to_state).toBe('LOCKED');

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

        // Create user
        const userRes = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizerId = userRes.rows[0].id;

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template 2', 'PGA', 'test_type_2', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest without tournament config
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 2', 20
          ) RETURNING id`,
          [templateId, organizerId],
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

        const userRes = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizerId = userRes.rows[0].id;

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template 3', 'PGA', 'test_type_3', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 3', 20
          ) RETURNING id`,
          [templateId, organizerId],
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

        const userRes = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizerId = userRes.rows[0].id;

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template 4', 'PGA', 'test_type_4', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 4', 20
          ) RETURNING id`,
          [templateId, organizerId],
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

        const user1Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer1Id = user1Res.rows[0].id;

        const user2Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer2Id = user2Res.rows[0].id;

        const user3Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer3Id = user3Res.rows[0].id;

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template 5', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest with provider_event_id (use unique event_id to avoid test conflicts)
        const uniqueEventId = `test_event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5', 20, $3
          ) RETURNING id`,
          [templateId, organizer1Id, uniqueEventId],
        );
        const contestId = contestRes.rows[0].id;

        // Create tournament configs with different provider_event_ids
        await client.query(
          `INSERT INTO tournament_configs (
            id, contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash, is_active
          ) VALUES (
            gen_random_uuid(), $1, $2, 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash123', true
          )`,
          [contestId, uniqueEventId],
        );

        // Create another contest with same event_id
        const contest2Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5B', 20, $3
          ) RETURNING id`,
          [templateId, organizer2Id, uniqueEventId],
        );
        const contest2Id = contest2Res.rows[0].id;

        await client.query(
          `INSERT INTO tournament_configs (
            id, contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash, is_active
          ) VALUES (
            gen_random_uuid(), $1, $2, 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash124', false
          )`,
          [contest2Id, uniqueEventId],
        );

        // Create config with different event_id (should be excluded)
        const uniqueEventId2 = `test_event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_diff`;
        const contest3Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, provider_event_id
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Test Contest 5C', 20, $3
          ) RETURNING id`,
          [templateId, organizer3Id, uniqueEventId2],
        );
        const contest3Id = contest3Res.rows[0].id;

        await client.query(
          `INSERT INTO tournament_configs (
            id, contest_instance_id, provider_event_id, ingestion_endpoint,
            event_start_date, event_end_date, leaderboard_schema_version,
            field_source, published_at, hash
          ) VALUES (
            gen_random_uuid(), $1, $2, 'https://espn.com/api',
            NOW(), NOW() + INTERVAL '1 day', 1,
            'provider_sync', NOW(), 'hash125'
          )`,
          [contest3Id, uniqueEventId2],
        );

        await client.query('COMMIT');

        // Fetch snapshot for contest 1 (should only see configs for the unique event id)
        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // All configs should be for the unique event_id (not the different event)
        expect(snapshot.tournament_configs.length).toBe(2);
        snapshot.tournament_configs.forEach((config) => {
          expect(config.provider_event_id).toBe(uniqueEventId);
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should compute participant count dynamically from contest_participants, not stale current_entries', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const userRes = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizerId = userRes.rows[0].id;

        const user1Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const userId1 = user1Res.rows[0].id;

        const user2Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const userId2 = user2Res.rows[0].id;

        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Dynamic Count Test', 'PGA', 'test_type', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create contest with current_entries = 0 (stale)
        const contestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, current_entries
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Dynamic Count Test', 20, 0
          ) RETURNING id`,
          [templateId, organizerId],
        );
        const contestId = contestRes.rows[0].id;

        // Manually add 2 participants (simulating stale current_entries)
        await client.query(
          `INSERT INTO contest_participants (contest_instance_id, user_id, joined_at)
           VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
          [contestId, userId1, userId2]
        );

        await client.query('COMMIT');

        // Fetch snapshot
        const snapshot = await contestOpsService.getContestOpsSnapshot(pool, contestId);

        // Verify capacity uses dynamic count from contest_participants, not stale current_entries
        expect(snapshot.capacity.participants_count).toBe(2);
        expect(snapshot.capacity.max_entries).toBe(20);
        expect(snapshot.capacity.remaining_slots).toBe(18);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('getMissingPicks', () => {
    it('should exclude non-system-generated contests', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const user1Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer1Id = user1Res.rows[0].id;

        const user2Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer2Id = user2Res.rows[0].id;

        const user3Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer3Id = user3Res.rows[0].id;

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template For Missing Picks', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create system-generated platform-owned contest
        const systemContestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'System Contest', 20, true, true
          ) RETURNING id`,
          [templateId, organizer1Id],
        );
        const systemContestId = systemContestRes.rows[0].id;

        // Create non-system-generated contest (should be excluded)
        const nonSystemContestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Non-System Contest', 20, false, true
          ) RETURNING id`,
          [templateId, organizer2Id],
        );
        const nonSystemContestId = nonSystemContestRes.rows[0].id;

        // Create non-platform-owned contest (should be excluded)
        const nonPlatformContestRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 5000, '[]'::jsonb,
            'SCHEDULED', 'Non-Platform Contest', 20, true, false
          ) RETURNING id`,
          [templateId, organizer3Id],
        );
        const nonPlatformContestId = nonPlatformContestRes.rows[0].id;

        await client.query('COMMIT');

        // Fetch missing picks
        const missingPicks = await contestOpsService.getMissingPicks(pool);

        // Verify only system-generated and platform-owned contests are returned
        const contestIds = missingPicks.map(c => c.contest_id);
        expect(contestIds).toContain(systemContestId);
        expect(contestIds).not.toContain(nonSystemContestId);
        expect(contestIds).not.toContain(nonPlatformContestId);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should include system-generated platform-owned contests in visible results', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const user1Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer1Id = user1Res.rows[0].id;

        const user2Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer2Id = user2Res.rows[0].id;

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template For Visible Contests', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create multiple system-generated platform-owned contests
        const contest1Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 1000, '[]'::jsonb,
            'SCHEDULED', 'Visible Contest 1', 10, true, true
          ) RETURNING id`,
          [templateId, organizer1Id],
        );
        const contest1Id = contest1Res.rows[0].id;

        const contest2Res = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 2000, '[]'::jsonb,
            'LOCKED', 'Visible Contest 2', 20, true, true
          ) RETURNING id`,
          [templateId, organizer2Id],
        );
        const contest2Id = contest2Res.rows[0].id;

        await client.query('COMMIT');

        // Fetch missing picks for all statuses
        const missingPicks = await contestOpsService.getMissingPicks(pool);

        // Verify both system-generated and platform-owned contests are returned
        const contestIds = missingPicks.map(c => c.contest_id);
        expect(contestIds).toContain(contest1Id);
        expect(contestIds).toContain(contest2Id);

        // Verify contest details
        const contest1Data = missingPicks.find(c => c.contest_id === contest1Id);
        expect(contest1Data.contest_name).toBe('Visible Contest 1');
        expect(contest1Data.status).toBe('SCHEDULED');
        expect(contest1Data.max_entries).toBe(10);
        expect(contest1Data.participant_count).toBe(0);
        expect(contest1Data.missing_picks).toBe(10);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('should respect status filter while applying system/platform filters', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const user1Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer1Id = user1Res.rows[0].id;

        const user2Res = await client.query(
          `INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`
        );
        const organizer2Id = user2Res.rows[0].id;

        // Create template
        const templateRes = await client.query(
          `INSERT INTO contest_templates (
            name, sport, template_type, scoring_strategy_key, lock_strategy_key,
            settlement_strategy_key, default_entry_fee_cents, allowed_entry_fee_min_cents,
            allowed_entry_fee_max_cents, allowed_payout_structures, is_active
          ) VALUES (
            'Test Template For Status Filter', 'PGA', 'standard', 'pga-scoring', 'default-lock',
            'pga-settlement', 5000, 0, 50000, '[]'::jsonb, false
          ) RETURNING id`,
        );
        const templateId = templateRes.rows[0].id;

        // Create SCHEDULED system-generated platform-owned contest
        const scheduledRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 1000, '[]'::jsonb,
            'SCHEDULED', 'Scheduled Contest', 10, true, true
          ) RETURNING id`,
          [templateId, organizer1Id],
        );
        const scheduledId = scheduledRes.rows[0].id;

        // Create LOCKED system-generated platform-owned contest
        const lockedRes = await client.query(
          `INSERT INTO contest_instances (
            template_id, organizer_id, entry_fee_cents, payout_structure,
            status, contest_name, max_entries, is_system_generated, is_platform_owned
          ) VALUES (
            $1, $2, 2000, '[]'::jsonb,
            'LOCKED', 'Locked Contest', 20, true, true
          ) RETURNING id`,
          [templateId, organizer2Id],
        );
        const lockedId = lockedRes.rows[0].id;

        await client.query('COMMIT');

        // Fetch missing picks filtered by SCHEDULED status only
        const scheduledPicks = await contestOpsService.getMissingPicks(pool, ['SCHEDULED']);

        // Verify only SCHEDULED contests are returned
        const contestIds = scheduledPicks.map(c => c.contest_id);
        expect(contestIds).toContain(scheduledId);
        expect(contestIds).not.toContain(lockedId);
        expect(scheduledPicks.every(c => c.status === 'SCHEDULED')).toBe(true);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});

module.exports = contestOpsService;
