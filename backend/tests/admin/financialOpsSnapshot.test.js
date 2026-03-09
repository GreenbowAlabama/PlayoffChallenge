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

    test('should have non-negative values for all aggregates', async () => {
      const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);

      expect(snapshot.ledger.total_credits_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.ledger.total_debits_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.wallets.wallet_liability_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.wallets.users_with_positive_balance).toBeGreaterThanOrEqual(0);
      expect(snapshot.contest_pools.contest_pools_cents).toBeGreaterThanOrEqual(0);
      expect(snapshot.contest_pools.negative_pool_contests).toBeGreaterThanOrEqual(0);
      expect(snapshot.settlement.pending_settlement_contests).toBeGreaterThanOrEqual(0);
      expect(snapshot.settlement.settlement_failures).toBeGreaterThanOrEqual(0);
      expect(snapshot.payouts.pending_payout_jobs).toBeGreaterThanOrEqual(0);
      expect(snapshot.payouts.failed_payout_transfers).toBeGreaterThanOrEqual(0);
    });

    test('should have coherent reconciliation logic', async () => {
      const snapshot = await financialOpsService.getFinancialOpsSnapshot(pool);
      const { reconciliation } = snapshot;

      // Expected = wallet_liability + contest_pools
      const computedExpected =
        snapshot.wallets.wallet_liability_cents +
        snapshot.contest_pools.contest_pools_cents;
      expect(reconciliation.expected_cents).toBe(computedExpected);

      // Actual = deposits - withdrawals
      const computedActual =
        reconciliation.deposits_cents - reconciliation.withdrawals_cents;
      expect(reconciliation.actual_cents).toBe(computedActual);

      // Difference = expected - actual
      const computedDifference =
        reconciliation.expected_cents - reconciliation.actual_cents;
      expect(reconciliation.difference_cents).toBe(computedDifference);

      // Status should be balanced if difference is 0, drift otherwise
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
});
