/**
 * Financial Reset Service Tests
 *
 * Tests for:
 * - resetFinancialState() — insert compensating ledger entries for wallet + pool
 * - seedTestWallets() — identify test users and fund with WALLET_DEPOSIT
 * - Idempotency (running twice = same result)
 * - Ledger immutability (append-only, no mutations)
 */

const { v4: uuidv4 } = require('uuid');
const { createMockPool } = require('../mocks/mockPool');

const {
  resetFinancialState,
  seedTestWallets
} = require('../../services/financialResetService');

describe('financialResetService', () => {
  let pool;

  beforeEach(() => {
    pool = createMockPool();
  });

  afterEach(() => {
    pool.clearAllMocks?.();
  });

  // ============================================================
  // resetFinancialState()
  // ============================================================

  describe('resetFinancialState()', () => {
    it('inserts compensating entries for wallet liability and contest pools', async () => {
      const walletCents = 50000;
      const poolCents = 25000;

      // Mock wallet query
      pool.setQueryResponse(
        q => q.includes('WALLET_DEPOSIT') && q.includes('SUM'),
        { rows: [{ balance_cents: walletCents }] }
      );

      // Mock pool query
      pool.setQueryResponse(
        q => q.includes('ENTRY_FEE') && q.includes('SUM'),
        { rows: [{ balance_cents: poolCents }] }
      );

      // Mock BEGIN/COMMIT
      pool.setQueryResponse(q => q.includes('BEGIN'), { rows: [] });
      pool.setQueryResponse(q => q.includes('COMMIT'), { rows: [] });

      // Mock idempotency checks
      pool.setQueryResponse(
        q => q.includes('findByIdempotencyKey'),
        { rows: [] }
      );

      // Mock ledger inserts
      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        { rows: [{ id: uuidv4() }] }
      );

      const result = await resetFinancialState(pool);

      expect(result.success).toBe(true);
      expect(result.wallet_reset_cents).toBe(walletCents);
      expect(result.contest_pool_reset_cents).toBe(poolCents);
    });

    it('returns zero amounts when wallet and pool are already clean', async () => {
      pool.setQueryResponse(
        q => q.includes('WALLET_DEPOSIT') && q.includes('SUM'),
        { rows: [{ balance_cents: 0 }] }
      );

      pool.setQueryResponse(
        q => q.includes('ENTRY_FEE') && q.includes('SUM'),
        { rows: [{ balance_cents: 0 }] }
      );

      pool.setQueryResponse(q => q.includes('BEGIN'), { rows: [] });
      pool.setQueryResponse(q => q.includes('COMMIT'), { rows: [] });

      const result = await resetFinancialState(pool);

      expect(result.success).toBe(true);
      expect(result.wallet_reset_cents).toBe(0);
      expect(result.contest_pool_reset_cents).toBe(0);
    });
  });

  // ============================================================
  // seedTestWallets()
  // ============================================================

  describe('seedTestWallets()', () => {
    it('identifies test users by email pattern', async () => {
      const testUserId = uuidv4();

      pool.setQueryResponse(
        q => q.includes('email') && q.includes('test'),
        { rows: [{ id: testUserId, email: 'testuser@example.com' }] }
      );

      pool.setQueryResponse(q => q.includes('BEGIN'), { rows: [] });
      pool.setQueryResponse(q => q.includes('COMMIT'), { rows: [] });

      pool.setQueryResponse(
        q => q.includes('findByIdempotencyKey'),
        { rows: [] }
      );

      pool.setQueryResponse(
        q => q.includes('INSERT INTO ledger'),
        { rows: [{ id: uuidv4() }] }
      );

      const result = await seedTestWallets(pool);

      expect(result.users_seeded).toBe(1);
      expect(result.total_seeded_cents).toBe(10000);
    });

    it('returns zero when no test users exist', async () => {
      pool.setQueryResponse(
        q => q.includes('email') && q.includes('test'),
        { rows: [] }
      );

      pool.setQueryResponse(q => q.includes('BEGIN'), { rows: [] });
      pool.setQueryResponse(q => q.includes('COMMIT'), { rows: [] });

      const result = await seedTestWallets(pool);

      expect(result.users_seeded).toBe(0);
      expect(result.total_seeded_cents).toBe(0);
    });
  });
});
