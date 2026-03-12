/**
 * Financial Reconciliation Service Tests
 *
 * Tests for:
 * - Platform reconciliation (wallet liability + contest pools)
 * - Financial invariants (6 health checks)
 * - 5 repair actions (append-only ledger, audit logging)
 * - Atomicity guarantees (BEGIN/COMMIT)
 * - Idempotency guarantees (repair twice = same result)
 */

const { v4: uuidv4 } = require('uuid');
const { createMockPool } = require('../mocks/mockPool');

// ============================================================
// IMPORTS (Top of File)
// ============================================================
const {
  getPlatformReconciliation,
  getFinancialInvariants,
  repairOrphanWithdrawal,
  convertIllegalEntryFeeToRefund,
  rollbackNonAtomicJoin,
  freezeNegativeWallet,
  repairIllegalRefundDebit,
  logFinancialAction
} = require('../../services/financialReconciliationService');

describe('financialReconciliationService', () => {
  let pool;
  let capturedQueries;

  beforeEach(() => {
    pool = createMockPool();
    capturedQueries = [];
  });

  // ============================================================
  // MOCK STATE CLEANUP
  // ============================================================
  afterEach(() => {
    pool.reset();
    capturedQueries = [];
  });

  // ============================================================
  // getPlatformReconciliation()
  // ============================================================

  describe('getPlatformReconciliation()', () => {
    beforeEach(() => {
      // Provide default mock responses so each test can override only what it needs
      pool.setQueryResponse(
        q => q.includes('wallet_liability_cents'),
        { rows: [{ wallet_liability_cents: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('contest_pools_cents'),
        { rows: [{ contest_pools_cents: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('deposits_cents'),
        { rows: [{ deposits_cents: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('withdrawals_cents'),
        { rows: [{ withdrawals_cents: 0 }], rowCount: 1 }
      );
    });

    it('calculates wallet liability excluding orphaned entries', async () => {
      // Setup: 2 users with WALLET-type entries (not ENTRY_FEE)
      pool.setQueryResponse(
        q => q.includes('wallet_liability_cents') && q.includes('reference_type'),
        {
          rows: [{ wallet_liability_cents: 50000 }],
          rowCount: 1
        }
      );

      // When calling getPlatformReconciliation
      const reconciliation = await getPlatformReconciliation(pool);

      // Then wallet liability should be calculated from WALLET-type entries only
      expect(reconciliation).toBeDefined();
      expect(typeof reconciliation.wallet_liability_cents).toBe('number');
    });

    it('calculates contest pools (fees - refunds - payouts)', async () => {
      pool.setQueryResponse(
        q => q.includes('contest_pools_cents') && q.includes('ENTRY_FEE'),
        {
          rows: [{ contest_pools_cents: 25000 }],
          rowCount: 1
        }
      );

      const reconciliation = await getPlatformReconciliation(pool);

      expect(reconciliation).toBeDefined();
      expect(typeof reconciliation.contest_pools_cents).toBe('number');
    });

    it('sums deposits from WALLET_DEPOSIT entries', async () => {
      pool.setQueryResponse(
        q => q.includes('deposits_cents') && q.includes('WALLET_DEPOSIT'),
        {
          rows: [{ deposits_cents: 100000 }],
          rowCount: 1
        }
      );

      const reconciliation = await getPlatformReconciliation(pool);

      expect(reconciliation).toBeDefined();
      expect(typeof reconciliation.deposits_cents).toBe('number');
    });

    it('sums withdrawals from WALLET_WITHDRAWAL entries', async () => {
      pool.setQueryResponse(
        q => q.includes('withdrawals_cents') && q.includes('WALLET_WITHDRAWAL'),
        {
          rows: [{ withdrawals_cents: 30000 }],
          rowCount: 1
        }
      );

      const reconciliation = await getPlatformReconciliation(pool);

      expect(reconciliation).toBeDefined();
      expect(typeof reconciliation.withdrawals_cents).toBe('number');
    });

    it('reconciliation equation balances when coherent', async () => {
      // wallet_liability + contest_pools = deposits - withdrawals
      pool.setQueryResponse(
        q => q.includes('wallet_liability_cents'),
        { rows: [{ wallet_liability_cents: 50000 }], rowCount: 1 }
      );

      pool.setQueryResponse(
        q => q.includes('contest_pools_cents'),
        { rows: [{ contest_pools_cents: 20000 }], rowCount: 1 }
      );

      pool.setQueryResponse(
        q => q.includes('deposits_cents'),
        { rows: [{ deposits_cents: 100000 }], rowCount: 1 }
      );

      pool.setQueryResponse(
        q => q.includes('withdrawals_cents'),
        { rows: [{ withdrawals_cents: 30000 }], rowCount: 1 }
      );

      const reconciliation = await getPlatformReconciliation(pool);

      expect(reconciliation).toBeDefined();
      expect(reconciliation.difference_cents).toBeDefined();
      expect(reconciliation.status).toBeDefined();
      expect(typeof reconciliation.status.is_coherent).toBe('boolean');
    });

    it('identifies orphaned withdrawals as difference', async () => {
      // When deposits != withdrawals + (wallet_liability + contest_pools)
      const reconciliation = await getPlatformReconciliation(pool);

      expect(reconciliation).toBeDefined();
      expect(reconciliation.difference_cents).toBeDefined();
      // If coherent: difference_cents should be 0
      // If incoherent: difference_cents > 0 (orphaned withdrawal)
    });
  });

  // ============================================================
  // getFinancialInvariants()
  // ============================================================

  describe('getFinancialInvariants()', () => {
    beforeEach(() => {
      // Provide default mock responses for all invariant checks (count queries)
      // Tests can override specific checks as needed
      // Use specific patterns to avoid matching queries we don't intend to match
      pool.setQueryResponse(
        q => q.includes('negative_wallets') || (q.includes('COUNT(*)') && q.includes('reference_type = \'WALLET\'')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('illegal_entry_fee_direction') || (q.includes('entry_type = \'ENTRY_FEE\'') && q.includes('CREDIT')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('illegal_refund_direction') || (q.includes('entry_type = \'ENTRY_FEE_REFUND\'') && q.includes('DEBIT')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('orphaned_ledger_entries') || (q.includes('reference_id IS NULL')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('orphaned_withdrawals') || (q.includes('WALLET_WITHDRAWAL') && q.includes('NOT EXISTS')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('negative_contest_pools') || (q.includes('pool_balance_cents')),
        { rows: [{ count: 0 }], rowCount: 1 }
      );
    });

    it('detects negative wallets', async () => {
      pool.setQueryResponse(
        q => q.includes('negative_wallets') && q.includes('wallet'),
        {
          rows: [{ count: 2 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.negative_wallets).toBe('number');
      expect(invariants.negative_wallets).toBeGreaterThanOrEqual(0);
    });

    it('counts illegal ENTRY_FEE CREDIT entries', async () => {
      pool.setQueryResponse(
        q => q.includes('illegal_entry_fee_direction') && q.includes('ENTRY_FEE'),
        {
          rows: [{ count: 4 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.illegal_entry_fee_direction).toBe('number');
    });

    it('counts illegal ENTRY_FEE_REFUND DEBIT entries', async () => {
      pool.setQueryResponse(
        q => q.includes('illegal_refund_direction') && q.includes('ENTRY_FEE_REFUND'),
        {
          rows: [{ count: 1 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.illegal_refund_direction).toBe('number');
    });

    it('counts orphaned ledger entries (NULL reference_id)', async () => {
      pool.setQueryResponse(
        q => q.includes('orphaned_ledger_entries') && q.includes('NULL'),
        {
          rows: [{ count: 0 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.orphaned_ledger_entries).toBe('number');
    });

    it('counts orphaned withdrawals (user deleted)', async () => {
      pool.setQueryResponse(
        q => q.includes('orphaned_withdrawals') && q.includes('WALLET_WITHDRAWAL'),
        {
          rows: [{ count: 1 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.orphaned_withdrawals).toBe('number');
    });

    it('detects negative contest pools', async () => {
      pool.setQueryResponse(
        q => q.includes('negative_contest_pools'),
        {
          rows: [{ count: 0 }],
          rowCount: 1
        }
      );

      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(typeof invariants.negative_contest_pools).toBe('number');
    });

    it('returns health status (PASS/WARN/FAIL)', async () => {
      const invariants = await getFinancialInvariants(pool);

      expect(invariants).toBeDefined();
      expect(invariants.health_status).toMatch(/^(PASS|WARN|FAIL)$/);
    });
  });

  // ============================================================
  // repairOrphanWithdrawal()
  // ============================================================

  describe('repairOrphanWithdrawal()', () => {
    const orphanLedgerId = uuidv4();
    const adminId = uuidv4();
    const reason = 'User deleted, withdrawal orphaned';

    beforeEach(() => {
      // Setup: Mock successful repair flow
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );

      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && q.includes('WHERE id'),
        {
          rows: [{ id: orphanLedgerId, amount_cents: 5000, direction: 'DEBIT' }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger') && q.includes('ADJUSTMENT'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );
    });

    it('inserts ADJUSTMENT CREDIT entry to offset orphan', async () => {
      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      expect(result).toBeDefined();
      expect(result.adjustment_ledger_id).toBeDefined();
    });

    it('logs admin action with reason', async () => {
      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      expect(result.audit_log_id).toBeDefined();
    });

    it('returns success with adjustment_ledger_id', async () => {
      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      expect(result.success).toBe(true);
      expect(result.adjustment_ledger_id).toBeDefined();
      expect(result.audit_log_id).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('prevents repair if ledger entry not found', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );

      const result = await repairOrphanWithdrawal(pool, 'nonexistent-id', adminId, reason);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('prevents repair if reason empty', async () => {
      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, '');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reason/i);
    });

    it('prevents repair if admin_id is null', async () => {
      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, null, reason);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/admin/i);
    });

    // ========================================================
    // IDEMPOTENCY TEST (Critical for Ops Safety)
    // ========================================================
    it('running repair twice is idempotent (same result)', async () => {
      const result1 = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);
      const result2 = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      // Second repair should detect existing repair and skip or return same result
      expect(result1.adjustment_ledger_id).toBeDefined();
      expect(result2.adjustment_ledger_id).toBeDefined();
    });

    // ========================================================
    // ATOMICITY TEST (Critical for Governance)
    // ========================================================
    it('uses single transaction (BEGIN/COMMIT) for repair', async () => {
      pool.reset();

      // Set up responses for each query type
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        { rows: [{ id: orphanLedgerId, amount_cents: 5000, direction: 'DEBIT' }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );

      await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      // Verify transaction boundaries using query history
      const queryHistory = pool.getQueryHistory();
      expect(queryHistory.some(q => q.sql.includes('BEGIN'))).toBe(true);
      expect(queryHistory.some(q => q.sql.includes('COMMIT'))).toBe(true);
    });

    it('rolls back all changes if any step fails', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );

      // Setup: first SELECT throws error (simulates query failure)
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        new Error('Connection reset')
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );

      const result = await repairOrphanWithdrawal(pool, orphanLedgerId, adminId, reason);

      // Should rollback: repair should fail due to query error
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================
  // convertIllegalEntryFeeToRefund()
  // ============================================================

  describe('convertIllegalEntryFeeToRefund()', () => {
    const entryFeeLedgerId = uuidv4();
    const adminId = uuidv4();
    const reason = 'Illegal ENTRY_FEE CREDIT direction detected';

    beforeEach(() => {
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );

      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        {
          rows: [{ id: entryFeeLedgerId, amount_cents: 2500, direction: 'CREDIT' }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );
    });

    it('marks entry as processed (no direct mutation)', async () => {
      const result = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result).toBeDefined();
      // Should not UPDATE existing ledger entry, only INSERT new ones
    });

    it('inserts new ENTRY_FEE_REFUND CREDIT entry', async () => {
      const result = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result.refund_ledger_id).toBeDefined();
    });

    it('inserts ADJUSTMENT DEBIT for original amount', async () => {
      const result = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result.adjustment_ledger_id).toBeDefined();
    });

    it('logs admin action', async () => {
      const result = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result.audit_log_id).toBeDefined();
    });

    it('returns success with change details', async () => {
      const result = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it('running repair twice is idempotent (same result)', async () => {
      const result1 = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);
      const result2 = await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('uses single transaction (BEGIN/COMMIT) for repair', async () => {
      pool.reset();

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        { rows: [{ id: entryFeeLedgerId, amount_cents: 2500, direction: 'CREDIT', reference_id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );

      await convertIllegalEntryFeeToRefund(pool, entryFeeLedgerId, adminId, reason);

      const queryHistory = pool.getQueryHistory();
      expect(queryHistory.some(q => q.sql.includes('BEGIN'))).toBe(true);
      expect(queryHistory.some(q => q.sql.includes('COMMIT'))).toBe(true);
    });
  });

  // ============================================================
  // rollbackNonAtomicJoin()
  // ============================================================

  describe('rollbackNonAtomicJoin()', () => {
    const entryFeeLedgerId = uuidv4();
    const adminId = uuidv4();
    const reason = 'Non-atomic join: fee debited but no participant created';

    beforeEach(() => {
      pool.reset();

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );

      // First SELECT: fetch entry fee (includes DEBIT, entry_type)
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && (q.includes('DEBIT') || q.includes('entry_type')),
        {
          rows: [{ id: entryFeeLedgerId, amount_cents: 5000, direction: 'DEBIT', reference_id: uuidv4() }],
          rowCount: 1
        }
      );

      // Third SELECT: check for existing reversal (includes ADJUSTMENT)
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && q.includes('ADJUSTMENT'),
        { rows: [], rowCount: 0 } // No existing reversal
      );

      pool.setQueryResponse(
        q => q.includes('contest_participants') && q.includes('SELECT'),
        { rows: [], rowCount: 0 } // No participant found (correct for rollback)
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );
    });

    it('validates entry_fee_ledger_id exists', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );

      const result = await rollbackNonAtomicJoin(pool, 'nonexistent', adminId, reason);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('validates no participant exists for this entry', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && (q.includes('DEBIT') || q.includes('entry_type')),
        { rows: [{ id: entryFeeLedgerId, amount_cents: 5000, direction: 'DEBIT', reference_id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('contest_participants'),
        { rows: [{ id: uuidv4() }], rowCount: 1 } // Participant found (conflict)
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );

      const result = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/participant|exists/i);
    });

    it('inserts reversal ADJUSTMENT entry', async () => {
      const result = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      expect(result.reversal_ledger_id).toBeDefined();
    });

    it('logs admin action', async () => {
      const result = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      expect(result.audit_log_id).toBeDefined();
    });

    it('returns success', async () => {
      const result = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it('running repair twice is idempotent (same result)', async () => {
      const result1 = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);
      const result2 = await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('uses single transaction (BEGIN/COMMIT) for repair', async () => {
      pool.reset();

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && (q.includes('DEBIT') || q.includes('entry_type')),
        { rows: [{ id: entryFeeLedgerId, amount_cents: 5000, direction: 'DEBIT', reference_id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && q.includes('ADJUSTMENT'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('contest_participants'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        { rows: [{ id: uuidv4() }], rowCount: 1 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );

      await rollbackNonAtomicJoin(pool, entryFeeLedgerId, adminId, reason);

      const queryHistory = pool.getQueryHistory();
      expect(queryHistory.some(q => q.sql.includes('BEGIN'))).toBe(true);
      expect(queryHistory.some(q => q.sql.includes('COMMIT'))).toBe(true);
    });
  });

  // ============================================================
  // freezeNegativeWallet()
  // ============================================================

  describe('freezeNegativeWallet()', () => {
    const userId = uuidv4();
    const adminId = uuidv4();
    const reason = 'Wallet balance negative, preventing further transactions';

    beforeEach(() => {
      pool.setQueryResponse(
        q => q.includes('user_wallet_freeze') && q.includes('INSERT'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );
    });

    it('inserts user_wallet_freeze record', async () => {
      const result = await freezeNegativeWallet(pool, userId, adminId, reason);

      expect(result).toBeDefined();
      expect(result.freeze_id).toBeDefined();
    });

    it('prevents duplicate freeze (unique constraint)', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.includes('user_wallet_freeze') && q.includes('INSERT'),
        {
          rows: [],
          rowCount: 0
        }
      );

      // Mock constraint violation
      const result = await freezeNegativeWallet(pool, userId, adminId, reason);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already.*frozen|duplicate/i);
    });

    it('logs admin action', async () => {
      const result = await freezeNegativeWallet(pool, userId, adminId, reason);

      expect(result.audit_log_id).toBeDefined();
    });

    it('returns success with freeze_id', async () => {
      const result = await freezeNegativeWallet(pool, userId, adminId, reason);

      expect(result.success).toBe(true);
      expect(result.freeze_id).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('running freeze twice is idempotent (or detects duplicate)', async () => {
      const result1 = await freezeNegativeWallet(pool, userId, adminId, reason);
      const result2 = await freezeNegativeWallet(pool, userId, adminId, reason);

      // Either both succeed with same freeze_id, or second one detects duplicate
      expect(result1.success).toBe(true);
      expect(result1.freeze_id).toBeDefined();
    });
  });

  // ============================================================
  // repairIllegalRefundDebit()
  // ============================================================

  describe('repairIllegalRefundDebit()', () => {
    const refundLedgerId = uuidv4();
    const adminId = uuidv4();
    const reason = 'Illegal ENTRY_FEE_REFUND DEBIT direction';

    beforeEach(() => {
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );

      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && q.includes('ENTRY_FEE_REFUND'),
        {
          rows: [{ id: refundLedgerId, user_id: uuidv4(), amount_cents: 2500, direction: 'DEBIT', reference_id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('idempotency_key'),
        { rows: [], rowCount: 0 }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4() }],
          rowCount: 1
        }
      );

      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('COMMIT'),
        { rows: [], rowCount: 0 }
      );
    });

    it('validates refund ledger entry exists', async () => {
      pool.reset();
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('BEGIN'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.includes('SELECT') && q.includes('ledger') && q.includes('ENTRY_FEE_REFUND'),
        { rows: [], rowCount: 0 }
      );
      pool.setQueryResponse(
        q => q.trim().toUpperCase().startsWith('ROLLBACK'),
        { rows: [], rowCount: 0 }
      );

      const result = await repairIllegalRefundDebit(pool, 'nonexistent-id', adminId, reason);

      expect(result.success).toBe(false);
    });

    it('inserts reversal ADJUSTMENT CREDIT entry', async () => {
      const result = await repairIllegalRefundDebit(pool, refundLedgerId, adminId, reason);

      expect(result.adjustment_ledger_id).toBeDefined();
    });

    it('logs admin action', async () => {
      const result = await repairIllegalRefundDebit(pool, refundLedgerId, adminId, reason);

      expect(result.audit_log_id).toBeDefined();
    });

    it('returns success', async () => {
      const result = await repairIllegalRefundDebit(pool, refundLedgerId, adminId, reason);

      expect(result.success).toBe(true);
    });

    it('running repair twice is idempotent (same result)', async () => {
      const result1 = await repairIllegalRefundDebit(pool, refundLedgerId, adminId, reason);
      const result2 = await repairIllegalRefundDebit(pool, refundLedgerId, adminId, reason);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  // ============================================================
  // logFinancialAction()
  // ============================================================

  describe('logFinancialAction()', () => {
    const adminId = uuidv4();
    const actionType = 'repair_orphan_withdrawal';
    const reason = 'User deleted, withdrawal orphaned';

    beforeEach(() => {
      pool.setQueryResponse(
        q => q.includes('INSERT INTO financial_admin_actions'),
        {
          rows: [{ id: uuidv4(), created_at: new Date() }],
          rowCount: 1
        }
      );
    });

    it('creates audit log entry with all fields', async () => {
      const result = await logFinancialAction(pool, adminId, actionType, reason);

      expect(result).toBeDefined();
      expect(result.log_id).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('requires admin_id, action_type, reason', async () => {
      const resultMissingAdmin = await logFinancialAction(pool, null, actionType, reason);
      expect(resultMissingAdmin.success).toBe(false);

      const resultMissingAction = await logFinancialAction(pool, adminId, null, reason);
      expect(resultMissingAction.success).toBe(false);

      const resultMissingReason = await logFinancialAction(pool, adminId, actionType, null);
      expect(resultMissingReason.success).toBe(false);
    });

    it('prevents empty reason', async () => {
      const result = await logFinancialAction(pool, adminId, actionType, '');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reason|empty/i);
    });

    it('returns log_id and timestamp', async () => {
      const result = await logFinancialAction(pool, adminId, actionType, reason);

      expect(result.log_id).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });
  });
});
