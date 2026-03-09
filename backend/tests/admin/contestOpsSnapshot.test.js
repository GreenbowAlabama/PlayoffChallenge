/**
 * Contest Ops Snapshot Service Tests
 *
 * Tests for contestOpsService.getContestOpsSnapshot()
 * Verifies that contest operations diagnostics aggregate signals correctly
 * and compute joinability accurately.
 */

const { v4: uuidv4 } = require('uuid');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const contestOpsService = require('../../services/contestOpsService');

describe('Contest Ops Service - getContestOpsSnapshot', () => {
  const testPrefix = `contestops_${Date.now()}`;
  let pool;
  let client;
  let testUserId;
  let testTemplateId;

  beforeAll(function () {
    const { pool: testPool } = getIntegrationApp();
    pool = testPool;
  });

  beforeEach(async function () {
    // Start transaction for test isolation
    client = await pool.connect();
    await client.query('BEGIN');

    // Create test user
    testUserId = uuidv4();
    await client.query(
      `INSERT INTO users (id, username, email)
       VALUES ($1, $2, $3)`,
      [testUserId, `${testPrefix}_user`, `${testPrefix}_user@example.com`]
    );

    // Create test template
    testTemplateId = uuidv4();
    await client.query(
      `INSERT INTO contest_templates (
         id, name, sport, template_type, scoring_strategy_key, lock_strategy_key, settlement_strategy_key,
         default_entry_fee_cents, allowed_entry_fee_min_cents, allowed_entry_fee_max_cents,
         allowed_payout_structures, is_system_generated
       ) VALUES ($1, $2, 'PGA', 'standard', 'pga_strokes', 'lock_at_tournament_start', 'pga_settlement',
         5000, 1000, 50000, '[]'::jsonb, false)`,
      [testTemplateId, `${testPrefix}_template`]
    );
  });

  afterEach(async function () {
    // Rollback transaction
    if (client) {
      await client.query('ROLLBACK');
      client.release();
      client = null;
    }
  });

  it('should return contest snapshot with all required fields', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_1`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_1`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot).toHaveProperty('contest');
    expect(snapshot).toHaveProperty('lifecycle');
    expect(snapshot).toHaveProperty('capacity');
    expect(snapshot).toHaveProperty('tournament');
    expect(snapshot).toHaveProperty('player_pool');
    expect(snapshot).toHaveProperty('ingestion');
    expect(snapshot).toHaveProperty('workers');
    expect(snapshot).toHaveProperty('joinability');
  });

  it('should compute joinability correctly for SCHEDULED contest with capacity', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, current_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, 5, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_joinable`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_joinable`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.joinability).toEqual({
      joinable: true,
      reason: null
    });
  });

  it('should mark contest as not joinable when LOCKED', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() - 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'LOCKED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_locked`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_locked`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.joinability.joinable).toBe(false);
    expect(snapshot.joinability.reason).toBe('contest_not_scheduled');
  });

  it('should mark contest as not joinable when full', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, current_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 2, 2, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_full`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_full`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.joinability.joinable).toBe(false);
    expect(snapshot.joinability.reason).toBe('contest_full');
  });

  it('should return correct capacity information', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, current_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, 8, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_capacity`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_capacity`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.capacity).toHaveProperty('participants_count');
    expect(snapshot.capacity).toHaveProperty('max_entries');
    expect(snapshot.capacity).toHaveProperty('remaining_slots');
    expect(snapshot.capacity.participants_count).toBe(8);
    expect(snapshot.capacity.max_entries).toBe(20);
    expect(snapshot.capacity.remaining_slots).toBe(12);
  });

  it('should return lifecycle aggregation', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_lifecycle`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_lifecycle`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.lifecycle).toHaveProperty('transitions');
    expect(snapshot.lifecycle).toHaveProperty('aggregated');
    expect(snapshot.lifecycle.aggregated).toHaveProperty('current_state');
    expect(snapshot.lifecycle.aggregated).toHaveProperty('last_transition');
    expect(snapshot.lifecycle.aggregated).toHaveProperty('transition_count');
    expect(snapshot.lifecycle.aggregated.current_state).toBe('SCHEDULED');
    expect(typeof snapshot.lifecycle.aggregated.transition_count).toBe('number');
  });

  it('should return tournament information', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_tournament`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_tournament`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.tournament).toHaveProperty('provider_event_id');
    expect(snapshot.tournament).toHaveProperty('event_start_date');
    expect(snapshot.tournament).toHaveProperty('event_end_date');
    expect(snapshot.tournament).toHaveProperty('is_active');
    expect(snapshot.tournament).toHaveProperty('published_at');
  });

  it('should return player pool information', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_pool`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_pool`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.player_pool).toHaveProperty('exists');
    expect(snapshot.player_pool).toHaveProperty('player_count');
    expect(snapshot.player_pool).toHaveProperty('created_at');
    expect(typeof snapshot.player_pool.exists).toBe('boolean');
    expect(typeof snapshot.player_pool.player_count).toBe('number');
  });

  it('should return ingestion runs', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_ingestion`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_ingestion`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.ingestion).toHaveProperty('latest_runs');
    expect(Array.isArray(snapshot.ingestion.latest_runs)).toBe(true);
  });

  it('should return worker heartbeats', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_workers`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_workers`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(Array.isArray(snapshot.workers)).toBe(true);
    if (snapshot.workers.length > 0) {
      snapshot.workers.forEach(worker => {
        expect(worker).toHaveProperty('worker_name');
        expect(worker).toHaveProperty('status');
        expect(worker).toHaveProperty('last_run_at');
        expect(worker).toHaveProperty('error_count');
      });
    }
  });

  it('should throw error for non-existent contest', async function () {
    const nonExistentId = uuidv4();

    await expect(
      contestOpsService.getContestOpsSnapshot(client, nonExistentId, { useProvidedClient: true })
    ).rejects.toThrow('Contest not found');
  });

  it('should handle contests with no player pool', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_nopool`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_nopool`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.player_pool.exists).toBe(false);
    expect(snapshot.player_pool.player_count).toBe(0);
  });

  it('should handle contests with no tournament config', async function () {
    const contestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_notourney`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_notourney`
      ]
    );

    const snapshot = await contestOpsService.getContestOpsSnapshot(client, contestId, { useProvidedClient: true });

    expect(snapshot.tournament.provider_event_id).toBeNull();
    expect(snapshot.tournament.is_active).toBe(false);
  });
});
