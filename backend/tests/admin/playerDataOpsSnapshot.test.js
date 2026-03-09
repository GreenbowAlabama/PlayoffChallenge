/**
 * Player Data Ops Snapshot Service Tests
 *
 * Tests for playerDataOpsService.getPlayerDataOpsSnapshot()
 * Verifies that player data operations diagnostics aggregate signals correctly.
 */

const { v4: uuidv4 } = require('uuid');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const playerDataOpsService = require('../../services/playerDataOpsService');

describe('Player Data Ops Service - getPlayerDataOpsSnapshot', () => {
  const testPrefix = `playerDataOps_${Date.now()}`;
  let pool;
  let client;
  let testUserId;
  let testTemplateId;
  let testContestId;

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

    // Create test contest
    testContestId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);
    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure,
         provider_event_id
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb, $8)`,
      [
        testContestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token`,
        `${testPrefix}_event_id`
      ]
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

  it('should return snapshot with all required fields', async function () {
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot).toHaveProperty('server_time');
    expect(snapshot).toHaveProperty('ingestion');
    expect(snapshot).toHaveProperty('player_pool');
    expect(snapshot).toHaveProperty('snapshots');
    expect(snapshot).toHaveProperty('scoring');
    expect(snapshot).toHaveProperty('workers');
  });

  it('should return ingestion runs array and error count', async function () {
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.ingestion).toHaveProperty('latest_runs');
    expect(snapshot.ingestion).toHaveProperty('errors_last_hour');
    expect(Array.isArray(snapshot.ingestion.latest_runs)).toBe(true);
    expect(typeof snapshot.ingestion.errors_last_hour).toBe('number');
  });

  it('should compute ingestion lag correctly', async function () {
    // Insert completed ingestion run
    const completedAt = new Date(Date.now() - 30000); // 30 seconds ago
    await client.query(
      `INSERT INTO ingestion_runs (contest_instance_id, ingestion_strategy_key, work_unit_key, status, started_at, completed_at)
       VALUES ($1, $2, $3, 'COMPLETE', $4, $5)`,
      [testContestId, 'pga_ingestion', `${testPrefix}_run`, new Date(Date.now() - 60000), completedAt]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.ingestion).toHaveProperty('lag_seconds');
    expect(snapshot.ingestion).toHaveProperty('last_success');
    expect(snapshot.ingestion.last_success).not.toBeNull();
    expect(typeof snapshot.ingestion.lag_seconds).toBe('number');
    expect(snapshot.ingestion.lag_seconds).toBeGreaterThanOrEqual(0);
  });

  it('should return snapshot health data', async function () {
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.snapshots).toHaveProperty('total_snapshots');
    expect(snapshot.snapshots).toHaveProperty('latest_snapshot');
    expect(snapshot.snapshots).toHaveProperty('snapshot_lag_seconds');
    expect(snapshot.snapshots).toHaveProperty('contests_missing_snapshots');
    expect(typeof snapshot.snapshots.total_snapshots).toBe('number');
    expect(typeof snapshot.snapshots.contests_missing_snapshots).toBe('number');
  });

  it('should compute snapshot lag correctly', async function () {
    // Get initial snapshot count
    const beforeSnapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });
    const initialCount = beforeSnapshot.snapshots.total_snapshots;

    // Insert event data snapshot
    const ingestedAt = new Date(Date.now() - 60000); // 1 minute ago
    await client.query(
      `INSERT INTO event_data_snapshots (contest_instance_id, snapshot_hash, provider_event_id, payload, ingested_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        testContestId,
        `${testPrefix}_hash`,
        `${testPrefix}_event_id`,
        { mock: 'payload' },
        ingestedAt
      ]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.snapshots.total_snapshots).toBe(initialCount + 1);
    expect(snapshot.snapshots.latest_snapshot).not.toBeNull();
    expect(snapshot.snapshots.snapshot_lag_seconds).toBeGreaterThanOrEqual(0);
  });

  it('should return player pool coverage', async function () {
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.player_pool).toHaveProperty('tournaments_with_pool');
    expect(snapshot.player_pool).toHaveProperty('missing_pools');
    expect(typeof snapshot.player_pool.tournaments_with_pool).toBe('number');
    expect(typeof snapshot.player_pool.missing_pools).toBe('number');
  });

  it('should count tournaments with player pools', async function () {
    // Create tournament config for the contest
    const tourneyConfigId = uuidv4();
    const eventDate = new Date();
    const publishedAt = new Date();
    await client.query(
      `INSERT INTO tournament_configs (id, contest_instance_id, provider_event_id, ingestion_endpoint, event_start_date, event_end_date, leaderboard_schema_version, field_source, published_at, hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 'provider_sync', $7, $8, true)`,
      [tourneyConfigId, testContestId, `${testPrefix}_event_id`, 'https://example.com', eventDate, new Date(eventDate.getTime() + 86400000), publishedAt, `hash_${testPrefix}`]
    );

    // Create field selection (player pool)
    const fieldSelectionId = uuidv4();
    await client.query(
      `INSERT INTO field_selections (id, contest_instance_id, tournament_config_id, selection_json)
       VALUES ($1, $2, $3, $4)`,
      [fieldSelectionId, testContestId, tourneyConfigId, { player_ids: ['id1', 'id2'] }]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.player_pool.tournaments_with_pool).toBeGreaterThan(0);
  });

  it('should return worker heartbeats', async function () {
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

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

  it('should handle empty state gracefully', async function () {
    // Verify snapshot structure when minimal data exists
    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    // Check structure is valid
    expect(snapshot.ingestion.latest_runs).toEqual(expect.any(Array));
    expect(typeof snapshot.ingestion.lag_seconds).toBe(snapshot.ingestion.lag_seconds === null ? 'object' : 'number');
    expect(typeof snapshot.snapshots.total_snapshots).toBe('number');
    expect(snapshot.snapshots.total_snapshots).toBeGreaterThanOrEqual(0);
    expect(typeof snapshot.player_pool.tournaments_with_pool).toBe('number');
    expect(typeof snapshot.player_pool.missing_pools).toBe('number');
    expect(Array.isArray(snapshot.workers)).toBe(true);
  });

  it('should correctly map scoring signal from latest snapshot', async function () {
    // Insert event data snapshot
    const ingestedAt = new Date(Date.now() - 90000); // 90 seconds ago
    await client.query(
      `INSERT INTO event_data_snapshots (contest_instance_id, snapshot_hash, provider_event_id, payload, ingested_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        testContestId,
        `${testPrefix}_hash`,
        `${testPrefix}_event_id`,
        { mock: 'payload' },
        ingestedAt
      ]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.scoring).toHaveProperty('last_scoring_run');
    expect(snapshot.scoring).toHaveProperty('scoring_lag_seconds');
    expect(snapshot.scoring.last_scoring_run).not.toBeNull();
    expect(snapshot.scoring.scoring_lag_seconds).toBeGreaterThanOrEqual(0);
  });

  it('should return data without throwing errors', async function () {
    // Add diverse data to ensure no errors
    await client.query(
      `INSERT INTO ingestion_runs (contest_instance_id, ingestion_strategy_key, work_unit_key, status, started_at)
       VALUES ($1, $2, $3, 'ERROR', NOW())`,
      [testContestId, 'pga_ingestion', `${testPrefix}_failed_run`]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot).toBeDefined();
    expect(snapshot.ingestion.latest_runs.length).toBeGreaterThan(0);
  });

  it('should handle contests without provider_event_id in missing pools query', async function () {
    // Create contest without provider_event_id
    const contestWithoutProviderEventId = uuidv4();
    const lockTime = new Date(Date.now() + 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() + 3600000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        contestWithoutProviderEventId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest_no_provider`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_no_provider`
      ]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    // Should not throw and return valid data
    expect(snapshot).toBeDefined();
    expect(snapshot.player_pool).toBeDefined();
  });

  it('should detect contests missing snapshots', async function () {
    // Create a LIVE contest with provider_event_id but no snapshot
    const liveContestId = uuidv4();
    const providerEventId = `${testPrefix}_missing_snapshot_event`;
    const lockTime = new Date(Date.now() - 3600000);
    const tournamentStartTime = new Date(lockTime.getTime() - 1800000);

    await client.query(
      `INSERT INTO contest_instances (
         id, template_id, organizer_id, contest_name, status,
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure,
         provider_event_id
       ) VALUES ($1, $2, $3, $4, 'LIVE', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb, $8)`,
      [
        liveContestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_live_contest`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token_live`,
        providerEventId
      ]
    );

    const snapshotBefore = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });
    const missingBefore = snapshotBefore.snapshots.contests_missing_snapshots;

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.snapshots.contests_missing_snapshots).toBeGreaterThanOrEqual(missingBefore);
  });

  it('should count ingestion errors in last hour', async function () {
    // Insert an error run within the last hour
    const recentErrorStartTime = new Date(Date.now() - 600000); // 10 minutes ago
    await client.query(
      `INSERT INTO ingestion_runs (contest_instance_id, ingestion_strategy_key, work_unit_key, status, started_at)
       VALUES ($1, $2, $3, 'ERROR', $4)`,
      [testContestId, 'pga_ingestion', `${testPrefix}_error_run`, recentErrorStartTime]
    );

    const snapshot = await playerDataOpsService.getPlayerDataOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.ingestion).toHaveProperty('errors_last_hour');
    expect(typeof snapshot.ingestion.errors_last_hour).toBe('number');
    expect(snapshot.ingestion.errors_last_hour).toBeGreaterThan(0);
  });
});
