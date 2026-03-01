/**
 * Wallet Balance Tests — Empty Wallet (No Ledger Entries)
 *
 * Purpose: Verify balance derivation when user has no wallet ledger entries.
 * - Assert balance_cents = 0
 * - Assert endpoint returns 200
 * - Assert no mutation side effects
 */

const request = require('supertest');
const express = require('express');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockPool } = require('../mocks/mockPool');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

describe('Wallet Balance — Empty', () => {
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

  it('should return 0 balance when no wallet ledger entries exist', async () => {
    // Mock the SUM query to return 0 for empty wallet
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 0 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: 0
    });
  });

  it('should return 401 if authentication header missing', async () => {
    const response = await request(app)
      .get('/api/wallet')
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  it('should not mutate wallet state when querying balance', async () => {
    let queryCount = 0;
    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = jest.fn(async function(sql, params) {
      queryCount++;
      // Only allow SELECT queries
      if (!sql.trim().toUpperCase().startsWith('SELECT')) {
        throw new Error('Mutation attempted on read-only operation');
      }
      return originalQuery.call(mockPool, sql, params);
    });

    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 0 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(queryCount).toBe(1);
  });
});
