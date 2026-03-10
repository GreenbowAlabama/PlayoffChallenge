/**
 * Financial Ops Snapshot Service Tests
 *
 * Tests the complete financial operations snapshot aggregation.
 * Verifies reuse of existing services and correct field names.
 */

const { pool } = require('../../server');
const financialOpsService = require('../../services/financialOpsService');

describe('Financial Ops Service', () => {
  let client;

  beforeAll(async () => {
    // Pool is imported from server
  });

  afterEach(async () => {
    if (client) {
      await client.release();
      client = null;
    }
  });

  describe('getFinancialOpsSnapshot', () => {
    test('should return complete financial snapshot with all required fields', async () => {
      const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);

      // Verify server_time is present and valid
      expect(snapshot.server_time).toBeDefined();
      expect(snapshot.server_time instanceof Date).toBe(true);

      // Verify ledger section
      expect(snapshot.ledger).toBeDefined();
      expect(snapshot.ledger.total_credits_cents).toBeDefined();
      expect(snapshot.ledger.total_debits_cents).toBeDefined();
      expect(snapshot.ledger.net_cents).toBeDefined();
      expect(typeof snapshot.ledger.total_credits_cents).toBe('number');
      expect(typeof snapshot.ledger.total_debits_cents).toBe('number');
      expect(typeof snapshot.ledger.net_cents).toBe('number');

      // Verify wallets section
      expect(snapshot.wallets).toBeDefined();
      expect(snapshot.wallets.wallet_liability_cents).toBeDefined();
      expect(snapshot.wallets.users_with_positive_balance).toBeDefined();
      expect(typeof snapshot.wallets.wallet_liability_cents).toBe('number');
      expect(typeof snapshot.wallets.users_with_positive_balance).toBe('number');

      // Verify contest_pools section
      expect(snapshot.contest_pools).toBeDefined();
      expect(snapshot.contest_pools.contest_pools_cents).toBeDefined();
      expect(snapshot.contest_pools.negative_pool_contests).toBeDefined();
      expect(typeof snapshot.contest_pools.contest_pools_cents).toBe('number');
      expect(typeof snapshot.contest_pools.negative_pool_contests).toBe('number');

      // Verify settlement section
      expect(snapshot.settlement).toBeDefined();
      expect(snapshot.settlement.pending_settlement_contests).toBeDefined();
      expect(snapshot.settlement.settlement_failures).toBeDefined();
      expect(typeof snapshot.settlement.pending_settlement_contests).toBe('number');
      expect(typeof snapshot.settlement.settlement_failures).toBe('number');

      // Verify payouts section
      expect(snapshot.payouts).toBeDefined();
      expect(snapshot.payouts.pending_payout_jobs).toBeDefined();
      expect(snapshot.payouts.failed_payout_transfers).toBeDefined();
      expect(typeof snapshot.payouts.pending_payout_jobs).toBe('number');
      expect(typeof snapshot.payouts.failed_payout_transfers).toBe('number');

      // Verify reconciliation section
      expect(snapshot.reconciliation).toBeDefined();
      expect(snapshot.reconciliation.deposits_cents).toBeDefined();
      expect(snapshot.reconciliation.withdrawals_cents).toBeDefined();
      expect(snapshot.reconciliation.expected_cents).toBeDefined();
      expect(snapshot.reconciliation.actual_cents).toBeDefined();
      expect(snapshot.reconciliation.difference_cents).toBeDefined();
      expect(snapshot.reconciliation.status).toBeDefined();
      expect(typeof snapshot.reconciliation.deposits_cents).toBe('number');
      expect(typeof snapshot.reconciliation.withdrawals_cents).toBe('number');
      expect(typeof snapshot.reconciliation.expected_cents).toBe('number');
      expect(typeof snapshot.reconciliation.actual_cents).toBe('number');
      expect(typeof snapshot.reconciliation.difference_cents).toBe('number');
      expect(['balanced', 'drift']).toContain(snapshot.reconciliation.status);
    });

    test('should have non-negative values for all counts and ledger totals', async () => {
      const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);

      expect(snapshot.ledger.total_credits_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.ledger.total_debits_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.wallets.wallet_liability_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.wallets.users_with_positive_balance).toBeGreaterThanOrEqual(0);
      // Contest pools can be negative (this is what repairContestPools fixes)
      expect(typeof snapshot.contest_pools.contest_pools_cents).toBe('number');
      expect(snapshot.contest_pools.negative_pool_contests).toBeGreaterThanOrEqual(0);
      expect(snapshot.settlement.pending_settlement_contests).toBeGreaterThanOrEqual(0);
      expect(snapshot.settlement.settlement_failures).toBeGreaterThanOrEqual(0);
      expect(snapshot.payouts.pending_payout_jobs).toBeGreaterThanOrEqual(0);
      expect(snapshot.payouts.failed_payout_transfers).toBeGreaterThanOrEqual(0);
    });

    test('should have coherent reconciliation logic', async () => {
      const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);
      const { reconciliation } = snapshot;

      // Expected = ledger_net (the source of truth)
      // This is the sum of all CREDIT - DEBIT entries across all domains
      const computedExpected = snapshot.ledger.net_cents;
      expect(reconciliation.expected_cents).toBe(computedExpected);

      // Actual = deposits - withdrawals (Stripe net)
      // This is WALLET_DEPOSIT - WALLET_WITHDRAWAL only
      const computedActual =
        reconciliation.deposits_cents - reconciliation.withdrawals_cents;
      expect(reconciliation.actual_cents).toBe(computedActual);

      // Difference = expected - actual
      const computedDifference =
        reconciliation.expected_cents - reconciliation.actual_cents;
      expect(reconciliation.difference_cents).toBe(computedDifference);

      // Status should be balanced if difference is 0, drift otherwise
      // Platform is balanced when ledger_net == deposits - withdrawals
      const expectedStatus = reconciliation.difference_cents === 0 ? 'balanced' : 'drift';
      expect(reconciliation.status).toBe(expectedStatus);
    });

    test('should support provided client for transaction context', async () => {
      client = await pool.connect();

      const snapshot = await financialOpsService.getFinancialOpsSnapshot(client, {
        useProvidedClient: true
      });

      // Verify snapshot is valid
      expect(snapshot.server_time).toBeDefined();
      expect(snapshot.ledger).toBeDefined();
      expect(snapshot.wallets).toBeDefined();
      expect(snapshot.contest_pools).toBeDefined();
      expect(snapshot.settlement).toBeDefined();
      expect(snapshot.payouts).toBeDefined();
      expect(snapshot.reconciliation).toBeDefined();
    });

    test('should return consistent results across multiple calls', async () => {
      const snapshot1 = await financialOpsService.getFinancialOpsSnapshot(pool);
      const snapshot2 = await financialOpsService.getFinancialOpsSnapshot(pool);

      // Verify key metrics are consistent
      expect(snapshot1.ledger.total_credits_cents).toBe(snapshot2.ledger.total_credits_cents);
      expect(snapshot1.ledger.total_debits_cents).toBe(snapshot2.ledger.total_debits_cents);
      expect(snapshot1.wallets.wallet_liability_cents).toBe(snapshot2.wallets.wallet_liability_cents);
      expect(snapshot1.contest_pools.contest_pools_cents).toBe(snapshot2.contest_pools.contest_pools_cents);
      expect(snapshot1.reconciliation.deposits_cents).toBe(snapshot2.reconciliation.deposits_cents);
      expect(snapshot1.reconciliation.withdrawals_cents).toBe(snapshot2.reconciliation.withdrawals_cents);
    });
  });

  describe('repairContestPools', () => {
    test('should return result object with correct shape', async () => {
      const result = await financialOpsService.repairContestPools(pool);

      expect(result).toBeDefined();
      expect(typeof result.contests_scanned).toBe('number');
      expect(typeof result.contests_repaired).toBe('number');
      expect(typeof result.total_adjusted_cents).toBe('number');
      expect(result.contests_scanned).toBeGreaterThanOrEqual(0);
      expect(result.contests_repaired).toBeGreaterThanOrEqual(0);
      expect(result.total_adjusted_cents).toBeGreaterThanOrEqual(0);
    });

    test('should be idempotent: running twice produces same result and no additional entries', async () => {
      // Get baseline ledger state
      const ledgerBefore = await pool.query('SELECT COUNT(*) as count FROM ledger');
      const countBefore = parseInt(ledgerBefore.rows[0].count, 10);

      // Run repair first time
      const result1 = await financialOpsService.repairContestPools(pool);

      // Get ledger state after first repair
      const ledgerAfter1 = await pool.query('SELECT COUNT(*) as count FROM ledger');
      const countAfter1 = parseInt(ledgerAfter1.rows[0].count, 10);

      // Run repair second time
      const result2 = await financialOpsService.repairContestPools(pool);

      // Get ledger state after second repair
      const ledgerAfter2 = await pool.query('SELECT COUNT(*) as count FROM ledger');
      const countAfter2 = parseInt(ledgerAfter2.rows[0].count, 10);

      // Both runs should have scanned the same number of contests
      expect(result1.contests_scanned).toBe(result2.contests_scanned);

      // After second repair, no new entries should be added (idempotency)
      // Only new entries would be from first repair
      expect(countAfter2).toBe(countAfter1);

      // Verify idempotency key prevents duplicates
      const repairEntries = await pool.query(
        "SELECT COUNT(*) as count FROM ledger WHERE entry_type = 'ADJUSTMENT' AND reference_type = 'POOL_REPAIR'"
      );
      // Should have at most one ADJUSTMENT per contest, not duplicates
      const repairCount = parseInt(repairEntries.rows[0].count, 10);
      expect(repairCount).toBeLessThanOrEqual(result1.contests_repaired);
    });

    test('should create ADJUSTMENT entries only for contests with negative pools', async () => {
      const result = await financialOpsService.repairContestPools(pool);

      if (result.contests_repaired > 0) {
        // Verify ADJUSTMENT entries were created
        const adjustments = await pool.query(
          "SELECT * FROM ledger WHERE entry_type = 'ADJUSTMENT' AND reference_type = 'CONTEST' AND idempotency_key LIKE 'pool-repair-%' ORDER BY created_at DESC LIMIT 10"
        );

        expect(adjustments.rowCount).toBeGreaterThan(0);

        // Verify all adjustments are CREDIT direction (to offset negative balances)
        adjustments.rows.forEach(entry => {
          expect(entry.direction).toBe('CREDIT');
          expect(entry.amount_cents).toBeGreaterThan(0);
        });
      }
    });

    test('should use deterministic idempotency keys', async () => {
      const result = await financialOpsService.repairContestPools(pool);

      if (result.contests_repaired > 0) {
        // Get repair entries
        const repairs = await pool.query(
          "SELECT idempotency_key FROM ledger WHERE entry_type = 'ADJUSTMENT' AND reference_type = 'CONTEST' AND idempotency_key LIKE 'pool-repair-%'"
        );

        // All keys should follow the pattern: pool-repair-{contest_id}
        repairs.rows.forEach(entry => {
          expect(entry.idempotency_key).toMatch(/^pool-repair-/);
        });

        // No duplicate keys (unique constraint should prevent this)
        const keys = repairs.rows.map(r => r.idempotency_key);
        const uniqueKeys = new Set(keys);
        expect(keys.length).toBe(uniqueKeys.size);
      }
    });
  });
});
