/**
 * Admin Diagnostics Service - Wallet Aggregates Tests
 *
 * Purpose: Verify wallet diagnostics aggregates are correctly calculated per user
 * - wallet_balance_cents: Sum of CREDIT (positive) and DEBIT (negative) entries
 * - total_deposits_cents: Sum of WALLET_DEPOSIT credits
 * - total_entry_fees_cents: Sum of ENTRY_FEE debits
 * - total_payouts_cents: Sum of PRIZE_PAYOUT credits
 * - total_refunds_cents: Sum of ENTRY_FEE_REFUND credits
 * - ledger_entry_count: COUNT of ledger rows
 *
 * Test Strategy:
 * - Create test users and ledger entries with unique data
 * - Verify aggregates match expected values
 * - Verify aggregates are user-scoped (no cross-user contamination)
 * - Verify null/zero handling
 */

const { getIntegrationApp } = require('../mocks/testAppFactory');
const diagnosticsService = require('../../services/adminDiagnostics.service');
const { randomUUID } = require('crypto');

describe('Admin Diagnostics Service - Wallet Aggregates', () => {
  let app;
  let pool;

  beforeAll(() => {
    const { app: integrationApp, pool: testPool } = getIntegrationApp();
    app = integrationApp;
    pool = testPool;
  });

  afterAll(async () => {
    // Don't explicitly end the pool here to avoid double-end issues
  });

  describe('getAllUserDiagnostics with wallet aggregates', () => {
    let testUserId1;
    let testUserId2;
    let counter = 0;

    beforeEach(async () => {
      counter++;
      testUserId1 = randomUUID();
      testUserId2 = randomUUID();
      const emailSuffix = `${Date.now()}_${counter}`;

      // Create two test users
      await pool.query(
        `INSERT INTO users (id, username, email, paid, is_admin, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [testUserId1, `user1_${emailSuffix}`, `user1_${emailSuffix}@test.com`, false, false, 'CA']
      );

      await pool.query(
        `INSERT INTO users (id, username, email, paid, is_admin, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [testUserId2, `user2_${emailSuffix}`, `user2_${emailSuffix}@test.com`, false, false, 'NY']
      );
    });

    async function insertLedgerEntry(userId, entryType, direction, amountCents) {
      // Determine reference_type based on entry_type
      // Valid schema values: 'stripe_event', 'CONTEST', 'WALLET'
      let referenceType;
      if (entryType === 'WALLET_DEPOSIT' || entryType === 'WALLET_WITHDRAWAL') {
        referenceType = 'WALLET';
      } else if (entryType === 'ENTRY_FEE' || entryType === 'ENTRY_FEE_REFUND' || entryType === 'PRIZE_PAYOUT') {
        referenceType = 'CONTEST';
      } else {
        referenceType = 'WALLET';
      }

      const referenceId = randomUUID();

      await pool.query(
        `INSERT INTO ledger (id, user_id, entry_type, direction, amount_cents, currency, reference_type, reference_id, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [randomUUID(), userId, entryType, direction, amountCents, 'USD', referenceType, referenceId, randomUUID().toString()]
      );
    }

    it('should include wallet_balance_cents calculated as SUM(CREDIT) - SUM(DEBIT)', async () => {
      // WALLET_DEPOSIT: $50.00 (CREDIT, +5000)
      // ENTRY_FEE: $30.00 (DEBIT, -3000)
      // Expected balance: 5000 - 3000 = 2000 cents
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 5000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 3000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1).toBeDefined();
      expect(user1.wallet_balance_cents).toBe(2000); // 5000 - 3000
    });

    it('should include total_deposits_cents as SUM of WALLET_DEPOSIT entries', async () => {
      // Create multiple WALLET_DEPOSIT entries
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 2000);
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 3000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.total_deposits_cents).toBe(5000); // 2000 + 3000
    });

    it('should include total_entry_fees_cents as SUM of ENTRY_FEE entries', async () => {
      // Create multiple ENTRY_FEE entries (DEBITs, so amounts are positive in ledger)
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 1000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 1500);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.total_entry_fees_cents).toBe(2500); // 1000 + 1500
    });

    it('should include total_payouts_cents as SUM of PRIZE_PAYOUT entries', async () => {
      // Create PRIZE_PAYOUT entries (CREDITs)
      await insertLedgerEntry(testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 10000);
      await insertLedgerEntry(testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.total_payouts_cents).toBe(15000); // 10000 + 5000
    });

    it('should include total_refunds_cents as SUM of ENTRY_FEE_REFUND entries', async () => {
      // Create ENTRY_FEE_REFUND entries (CREDITs)
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE_REFUND', 'CREDIT', 500);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE_REFUND', 'CREDIT', 750);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.total_refunds_cents).toBe(1250); // 500 + 750
    });

    it('should include ledger_entry_count as COUNT of ledger rows', async () => {
      // Create various ledger entries
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 2000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 1000);
      await insertLedgerEntry(testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 5000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.ledger_entry_count).toBe(3);
    });

    it('should return 0 for wallet aggregates when user has no ledger entries', async () => {
      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user2 = result.find(u => u.user_id === testUserId2);

      expect(user2).toBeDefined();
      expect(user2.wallet_balance_cents).toBe(0);
      expect(user2.total_deposits_cents).toBe(0);
      expect(user2.total_entry_fees_cents).toBe(0);
      expect(user2.total_payouts_cents).toBe(0);
      expect(user2.total_refunds_cents).toBe(0);
      expect(user2.ledger_entry_count).toBe(0);
    });

    it('should isolate aggregates per user (no cross-user contamination)', async () => {
      // Add entries to user1
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 5000);

      // Add different entries to user2
      await insertLedgerEntry(testUserId2, 'WALLET_DEPOSIT', 'CREDIT', 3000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);
      const user2 = result.find(u => u.user_id === testUserId2);

      expect(user1.wallet_balance_cents).toBe(5000);
      expect(user1.total_deposits_cents).toBe(5000);
      expect(user2.wallet_balance_cents).toBe(3000);
      expect(user2.total_deposits_cents).toBe(3000);
    });

    it('should handle mixed CREDIT and DEBIT for wallet balance calculation', async () => {
      // Create entries that result in a calculated balance
      // CREDIT 1000 + CREDIT 2000 - DEBIT 500 = 2500
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 1000);
      await insertLedgerEntry(testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 2000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 500);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.wallet_balance_cents).toBe(2500); // 1000 + 2000 - 500
    });

    it('should calculate all aggregates correctly in a single call', async () => {
      // Create a comprehensive set of ledger entries
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 10000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE', 'DEBIT', 2000);
      await insertLedgerEntry(testUserId1, 'PRIZE_PAYOUT', 'CREDIT', 15000);
      await insertLedgerEntry(testUserId1, 'ENTRY_FEE_REFUND', 'CREDIT', 500);
      await insertLedgerEntry(testUserId1, 'WALLET_DEPOSIT', 'CREDIT', 5000);

      const result = await diagnosticsService.getAllUserDiagnostics(pool);
      const user1 = result.find(u => u.user_id === testUserId1);

      expect(user1.wallet_balance_cents).toBe(28500); // 10000 + 15000 + 500 + 5000 - 2000
      expect(user1.total_deposits_cents).toBe(15000); // 10000 + 5000
      expect(user1.total_entry_fees_cents).toBe(2000);
      expect(user1.total_payouts_cents).toBe(15000);
      expect(user1.total_refunds_cents).toBe(500);
      expect(user1.ledger_entry_count).toBe(5);
    });
  });
});
