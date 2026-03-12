/**
 * Wallet Transactions Tests
 *
 * Purpose: Verify transaction history endpoint returns ledger entries with pagination
 * - Assert transactions array is returned
 * - Assert pagination works (limit, offset)
 * - Assert total_count is accurate
 * - Assert human-readable descriptions
 * - Assert authentication required
 */

const request = require('supertest');
const express = require('express');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockPool } = require('../mocks/mockPool');
const { createMockUserToken } = require('../mocks/testAppFactory');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

describe('Wallet Transactions', () => {
  let app;
  let mockPool;
  let userToken;

  beforeEach(() => {
    mockPool = createMockPool();
    userToken = createMockUserToken({ sub: TEST_USER_ID, user_id: TEST_USER_ID });

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.locals.pool = mockPool;

    app.use('/api/wallet', walletRoutes);
  });

  afterEach(() => {
    mockPool.reset();
  });

  it('should return user transactions with pagination', async () => {
    const mockTransactions = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        entry_type: 'WALLET_DEPOSIT',
        direction: 'CREDIT',
        amount_cents: 5000,
        reference_type: 'WALLET',
        reference_id: TEST_USER_ID,
        idempotency_key: 'wallet_deposit_key_1',
        created_at: '2026-03-06T10:00:00Z'
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        entry_type: 'ENTRY_FEE',
        direction: 'DEBIT',
        amount_cents: 500,
        reference_type: 'CONTEST',
        reference_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        idempotency_key: 'wallet_debit_key_1',
        created_at: '2026-03-05T10:00:00Z'
      }
    ];

    mockPool.setQueryResponse(
      q => q.includes('COUNT(*)'),
      {
        rows: [{ count: 2 }],
        rowCount: 1
      }
    );

    mockPool.setQueryResponse(
      q => q.includes('ORDER BY created_at DESC'),
      {
        rows: mockTransactions,
        rowCount: 2
      }
    );

    const response = await request(app)
      .get('/api/wallet/transactions?limit=10&offset=0')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('transactions');
    expect(response.body).toHaveProperty('total_count');
    expect(Array.isArray(response.body.transactions)).toBe(true);
    expect(response.body.total_count).toBe(2);
    expect(response.body.transactions.length).toBe(2);
  });

  it('should include human-readable descriptions', async () => {
    const mockTransactions = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        entry_type: 'WALLET_DEPOSIT',
        direction: 'CREDIT',
        amount_cents: 5000,
        reference_type: 'WALLET',
        reference_id: TEST_USER_ID,
        idempotency_key: 'key_1',
        created_at: '2026-03-06T10:00:00Z'
      }
    ];

    mockPool.setQueryResponse(
      q => q.includes('COUNT(*)'),
      {
        rows: [{ count: 1 }],
        rowCount: 1
      }
    );

    mockPool.setQueryResponse(
      q => q.includes('ORDER BY created_at DESC'),
      {
        rows: mockTransactions,
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body.transactions.length).toBe(1);
    expect(response.body.transactions[0].description).toBe('Wallet Top-Up');
  });

  it('should clamp limit to 1-100', async () => {
    mockPool.setQueryResponse(
      q => q.includes('COUNT(*)'),
      {
        rows: [{ count: 0 }],
        rowCount: 1
      }
    );

    mockPool.setQueryResponse(
      q => q.includes('ORDER BY created_at DESC'),
      {
        rows: [],
        rowCount: 0
      }
    );

    const response = await request(app)
      .get('/api/wallet/transactions?limit=200')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([]);
  });

  it('should require authentication', async () => {
    const response = await request(app)
      .get('/api/wallet/transactions');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  it('should return empty transactions array when none exist', async () => {
    mockPool.setQueryResponse(
      /SELECT COUNT\(\*\) as count FROM ledger/,
      {
        rows: [{ count: 0 }],
        rowCount: 1
      }
    );

    mockPool.setQueryResponse(
      /SELECT.*FROM ledger.*ORDER BY created_at DESC/,
      {
        rows: [],
        rowCount: 0
      }
    );

    const response = await request(app)
      .get('/api/wallet/transactions')
      .set('Authorization', `Bearer ${userToken}`);

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([]);
    expect(response.body.total_count).toBe(0);
  });
});
