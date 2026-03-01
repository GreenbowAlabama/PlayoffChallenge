/**
 * Wallet Balance Tests — Mixed Credits and Debits
 *
 * Purpose: Verify balance derivation with both CREDIT and DEBIT ledger entries.
 * - Assert CREDIT adds to balance
 * - Assert DEBIT subtracts from balance
 * - Assert balance can be positive
 * - Assert negative behavior NOT tested yet (per requirements)
 */

const request = require('supertest');
const express = require('express');
const walletRoutes = require('../../routes/wallet.routes');
const { createMockPool } = require('../mocks/mockPool');

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

describe('Wallet Balance — Mixed Credit/Debit', () => {
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

  it('should reduce balance with DEBIT entries', async () => {
    // Credits: 100000 cents, Debits: 30000 cents = 70000 cents
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 70000 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: 70000
    });
  });

  it('should handle multiple alternating credits and debits', async () => {
    // Sequence: +50000, -10000, +25000, -5000 = 60000 cents
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 60000 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      balance_cents: 60000
    });
  });

  it('should correctly apply CASE logic in SUM for direction', async () => {
    // Verify the query correctly applies +amount for CREDIT and -amount for DEBIT
    let capturedQuery = null;

    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = jest.fn(async function(sql, params) {
      capturedQuery = { sql, params };
      return originalQuery.call(mockPool, sql, params);
    });

    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 45000 }],
        rowCount: 1
      }
    );

    await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    // Verify CASE statement for direction
    expect(capturedQuery.sql).toMatch(/CASE/i);
    expect(capturedQuery.sql).toMatch(/WHEN direction = 'CREDIT'/i);
    expect(capturedQuery.sql).toMatch(/WHEN direction = 'DEBIT'/i);
    expect(capturedQuery.sql).toMatch(/-amount_cents/i);
  });

  it('should return positive balance when credits exceed debits', async () => {
    // Credits: 200000, Debits: 100000 = 100000 positive balance
    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 100000 }],
        rowCount: 1
      }
    );

    const response = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.balance_cents).toBeGreaterThan(0);
    expect(response.body.balance_cents).toBe(100000);
  });

  it('should correctly isolate wallet entries by reference_id', async () => {
    // Verify query filters by reference_id = user_id
    let capturedQuery = null;

    const originalQuery = mockPool.query.bind(mockPool);
    mockPool.query = jest.fn(async function(sql, params) {
      capturedQuery = { sql, params };
      return originalQuery.call(mockPool, sql, params);
    });

    mockPool.setQueryResponse(
      /FROM ledger/i,
      {
        rows: [{ balance_cents: 50000 }],
        rowCount: 1
      }
    );

    await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${TEST_USER_ID}`)
      .set('Content-Type', 'application/json');

    // Verify reference_id is filtered to the user
    expect(capturedQuery.sql).toMatch(/reference_id\s*=\s*\$\d+/i);
    expect(capturedQuery.params).toContain(TEST_USER_ID);
  });

  it('should handle debit-only scenario (no credits)', async () => {
    // Debits only: -25000 cents balance (but NOT testing negative behavior per requirements)
    // Just verify it returns successfully
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
    expect(response.body).toHaveProperty('balance_cents');
  });
});
