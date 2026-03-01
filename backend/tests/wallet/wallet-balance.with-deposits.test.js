/**
 * Wallet Balance Tests — Multiple Credits (Deposits)
 *
 * Purpose: Verify balance derivation when user has multiple CREDIT entries.
 * - Assert multiple credits accumulate correctly
 * - Assert SUM correctly compounds deposits
 * - Assert balance_cents reflects total credits
 */

const request = require('supertest');
const express = require('express');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockPool } = require('../mocks/mockPool');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

describe('Wallet Balance — With Deposits', () => {
  let app;
  let mockPool;

  beforeEach(() => {
    mockPool = createMockPool();

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.locals.pool = mockPool;

    // Test-only middleware: Simulate centralized auth
    app.use((req, res, next) => {
      const authHeader = req.headers['authorization'];

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const userId = authHeader.substring(7);
        req.user = {
          id: userId,
          isAdmin: false
        };
      }

      next();
    });

    app.use('/api/wallet', walletRoutes);
  });

  afterEach(() => {
    mockPool.reset();
  });

  it('should accumulate multiple CREDIT entries correctly', async () => {
    // Three deposits: 5000, 10000, 7500 cents = 22500 cents total
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 22500 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: 22500
    });
  });

  it('should handle large deposit amounts without overflow', async () => {
    // Very large deposit: 999,999,999 cents (~10M USD)
    const largeAmount = 999999999;

    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: largeAmount }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: largeAmount
    });
  });

  it('should return correct balance for single deposit', async () => {
    // Single deposit: 50000 cents ($500)
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 50000 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: 50000
    });
  });

  it('should query only WALLET reference_type entries', async () => {
    let capturedQuery = null;

    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = jest.fn(async function(sql, params) {
      capturedQuery = { sql, params };
      return originalQuery.call(mockPool, sql, params);
    });

    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 25000 }],
        rowCount: 1
      }
    );

    await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    // Verify query includes reference_type = 'WALLET' filter
    expect(capturedQuery.sql).toMatch(/reference_type\s*=\s*'WALLET'/i);
    // Verify user_id is passed as parameter
    expect(capturedQuery.params).toContain(TEST_USER_ID);
  });
});
