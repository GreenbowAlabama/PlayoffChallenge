/**
 * User Ops Snapshot Service Tests
 *
 * Tests for userOpsService.getUserOpsSnapshot()
 * Verifies that user operations diagnostics aggregate signals correctly.
 */

const { v4: uuidv4 } = require('uuid');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const userOpsService = require('../../services/userOpsService');

describe('User Ops Service - getUserOpsSnapshot', () => {
  const testPrefix = `userOps_${Date.now()}`;
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
         entry_fee_cents, max_entries, lock_time, tournament_start_time, join_token, payout_structure
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', 5000, 20, $5, $6, $7, '{"1":100}'::jsonb)`,
      [
        testContestId,
        testTemplateId,
        testUserId,
        `${testPrefix}_contest`,
        lockTime,
        tournamentStartTime,
        `${testPrefix}_token`
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
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot).toHaveProperty('server_time');
    expect(snapshot).toHaveProperty('users');
    expect(snapshot).toHaveProperty('wallets');
    expect(snapshot).toHaveProperty('participation');
  });

  it('should return user counts', async function () {
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.users).toHaveProperty('users_total');
    expect(snapshot.users).toHaveProperty('users_created_today');
    expect(snapshot.users).toHaveProperty('users_created_last_7_days');
    expect(typeof snapshot.users.users_total).toBe('number');
    expect(snapshot.users.users_total).toBeGreaterThan(0);
  });

  it('should return wallet signals', async function () {
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.wallets).toHaveProperty('users_with_wallet_balance');
    expect(snapshot.wallets).toHaveProperty('users_with_zero_balance');
    expect(snapshot.wallets).toHaveProperty('wallet_balance_total');
    expect(snapshot.wallets).toHaveProperty('wallet_balance_avg');
    expect(typeof snapshot.wallets.users_with_wallet_balance).toBe('number');
    expect(typeof snapshot.wallets.wallet_balance_total).toBe('number');
  });

  it('should return participation signals', async function () {
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.participation).toHaveProperty('users_joined_contests_today');
    expect(snapshot.participation).toHaveProperty('users_joined_contests_last_7_days');
    expect(snapshot.participation).toHaveProperty('avg_contests_per_user');
    expect(snapshot.participation).toHaveProperty('users_with_no_entries');
    expect(typeof snapshot.participation.users_joined_contests_today).toBe('number');
    expect(typeof snapshot.participation.avg_contests_per_user).toBe('number');
  });

  it('should compute wallet balance from ledger', async function () {
    // Create ledger entry for wallet credit (deposit)
    const creditEntryId = uuidv4();
    await client.query(
      `INSERT INTO ledger (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'WALLET_DEPOSIT', 'CREDIT', 5000, 'USD', 'WALLET', $3, $4)`,
      [creditEntryId, testUserId, uuidv4(), `${testPrefix}_credit_${Date.now()}`]
    );

    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.wallets.users_with_wallet_balance).toBeGreaterThan(0);
    expect(snapshot.wallets.wallet_balance_total).toBeGreaterThan(0);
  });

  it('should count users created today', async function () {
    const beforeSnapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });
    const countBefore = beforeSnapshot.users.users_created_today;

    // Create a new user
    const newUserId = uuidv4();
    await client.query(
      `INSERT INTO users (id, username, email)
       VALUES ($1, $2, $3)`,
      [newUserId, `${testPrefix}_new_user`, `${testPrefix}_new_user@example.com`]
    );

    const afterSnapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(afterSnapshot.users.users_created_today).toBe(countBefore + 1);
  });

  it('should count contest participants correctly', async function () {
    // Create contest participant entry
    const participantId = uuidv4();
    await client.query(
      `INSERT INTO contest_participants (id, contest_instance_id, user_id, joined_at)
       VALUES ($1, $2, $3, NOW())`,
      [participantId, testContestId, testUserId]
    );

    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(snapshot.participation.users_joined_contests_today).toBeGreaterThan(0);
    expect(snapshot.participation.avg_contests_per_user).toBeGreaterThan(0);
  });

  it('should calculate average contests per user', async function () {
    // Create contest participant
    const participantId = uuidv4();
    await client.query(
      `INSERT INTO contest_participants (id, contest_instance_id, user_id, joined_at)
       VALUES ($1, $2, $3, NOW())`,
      [participantId, testContestId, testUserId]
    );

    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    expect(typeof snapshot.participation.avg_contests_per_user).toBe('number');
    expect(snapshot.participation.avg_contests_per_user).toBeGreaterThanOrEqual(0);
  });

  it('should count users with no entries', async function () {
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    // Should include the test user without contest participation
    expect(snapshot.participation.users_with_no_entries).toBeGreaterThan(0);
  });

  it('should handle empty database state gracefully', async function () {
    const snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    // Verify snapshot structure is valid even with minimal data
    expect(snapshot.users.users_total).toBeGreaterThanOrEqual(0);
    expect(snapshot.wallets.users_with_wallet_balance).toBeGreaterThanOrEqual(0);
    expect(snapshot.wallets.wallet_balance_total).toBeGreaterThanOrEqual(0);
    expect(snapshot.participation.users_joined_contests_today).toBeGreaterThanOrEqual(0);
    expect(snapshot.participation.avg_contests_per_user).toBeGreaterThanOrEqual(0);
  });

  it('should not throw errors when executing queries', async function () {
    let hasError = false;
    let snapshot;
    try {
      snapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });
    } catch (err) {
      hasError = true;
    }

    expect(hasError).toBe(false);
    expect(snapshot).toBeDefined();
    expect(snapshot.server_time).toBeDefined();
  });

  it('should correctly aggregate wallet balances from ledger', async function () {
    const beforeSnapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });
    const balanceBefore = beforeSnapshot.wallets.wallet_balance_total;
    const countBefore = beforeSnapshot.wallets.users_with_wallet_balance;

    // Create credit entry for testUser
    const creditId = uuidv4();
    const creditAmount = 5000;
    await client.query(
      `INSERT INTO ledger (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'WALLET_DEPOSIT', 'CREDIT', $3, 'USD', 'WALLET', $4, $5)`,
      [creditId, testUserId, creditAmount, uuidv4(), `${testPrefix}_credit_${Date.now()}`]
    );

    const afterSnapshot = await userOpsService.getUserOpsSnapshot(client, { useProvidedClient: true });

    // Total balance should increase by exactly the credit amount
    expect(afterSnapshot.wallets.wallet_balance_total).toBe(balanceBefore + creditAmount);
    // User with balance count should increase by 1 (testUserId now has positive balance)
    expect(afterSnapshot.wallets.users_with_wallet_balance).toBe(countBefore + 1);
  });
});
