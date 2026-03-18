/**
 * Tests for Stripe Connect routes
 * - POST /api/stripe/connect/onboard
 * - GET /api/stripe/connect/status
 */

const request = require('supertest');
const express = require('express');

// Mock Stripe BEFORE any imports
jest.mock('stripe');

describe('Stripe Connect Routes', () => {
  let app;
  let mockPool;
  let stripeOnboardCreateStub;
  let stripeAccountLinksCreateStub;
  let stripeAccountsRetrieveStub;

  beforeEach(() => {
    // Clear require cache to ensure fresh modules
    jest.clearAllMocks();
    jest.resetModules();

    // Create fresh stubs
    stripeOnboardCreateStub = jest.fn();
    stripeAccountLinksCreateStub = jest.fn();
    stripeAccountsRetrieveStub = jest.fn();

    // Mock database pool
    mockPool = {
      query: jest.fn()
    };

    // Re-mock stripe after reset
    jest.mock('stripe');
    const stripeMock = require('stripe');
    stripeMock.mockReturnValue({
      accounts: {
        create: stripeOnboardCreateStub,
        retrieve: stripeAccountsRetrieveStub
      },
      accountLinks: {
        create: stripeAccountLinksCreateStub
      }
    });

    // Create Express app with routes
    app = express();
    app.use(express.json());
    app.locals.pool = mockPool;

    // Load routes
    const stripeRoutes = require('../../routes/stripe.routes');
    app.use('/api/stripe', stripeRoutes);
  });

  describe('POST /api/stripe/connect/onboard', () => {
    test('should create Stripe account on first call (account does not exist)', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440000';

      // Mock user query - no stripe_connected_account_id
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            stripe_connected_account_id: null,
            email: 'user@example.com'
          }
        ]
      });

      // Stub Stripe account creation
      stripeOnboardCreateStub.mockResolvedValueOnce({
        id: 'acct_new123'
      });

      // Stub account link creation
      stripeAccountLinksCreateStub.mockResolvedValueOnce({
        url: 'https://connect.stripe.com/onboarding/acct_new123'
      });

      // Mock user update
      mockPool.query.mockResolvedValueOnce({
        rows: []
      });

      const response = await request(app)
        .post('/api/stripe/connect/onboard')
        .set('X-User-Id', userId);

      expect(response.status).toBe(200);
      expect(response.body.url).toBe('https://connect.stripe.com/onboarding/acct_new123');
      expect(stripeOnboardCreateStub).toHaveBeenCalledWith({
        type: 'express',
        country: 'US',
        email: 'user@example.com'
      });
      expect(stripeAccountLinksCreateStub).toHaveBeenCalledWith({
        account: 'acct_new123',
        type: 'account_onboarding',
        refresh_url: expect.stringContaining('/stripe/refresh'),
        return_url: expect.stringContaining('/stripe/complete')
      });
    });

    test('should reuse existing account (idempotent)', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440001';

      // Mock user query - stripe_connected_account_id already exists
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            stripe_connected_account_id: 'acct_existing',
            email: 'user@example.com'
          }
        ]
      });

      // Stub account link creation (accounts.create should NOT be called)
      stripeAccountLinksCreateStub.mockResolvedValueOnce({
        url: 'https://connect.stripe.com/onboarding/acct_existing'
      });

      const response = await request(app)
        .post('/api/stripe/connect/onboard')
        .set('X-User-Id', userId);

      expect(response.status).toBe(200);
      expect(response.body.url).toBe('https://connect.stripe.com/onboarding/acct_existing');
      // Verify accounts.create was NOT called
      expect(stripeOnboardCreateStub).not.toHaveBeenCalled();
      // Verify accountLinks.create WAS called
      expect(stripeAccountLinksCreateStub).toHaveBeenCalledWith({
        account: 'acct_existing',
        type: 'account_onboarding',
        refresh_url: expect.stringContaining('/stripe/refresh'),
        return_url: expect.stringContaining('/stripe/complete')
      });
    });

    test('should return 401 without authentication', async () => {
      const response = await request(app).post('/api/stripe/connect/onboard');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('GET /api/stripe/complete', () => {
    test('should return HTML fallback page with deep link redirect', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.type).toContain('text/html');
      expect(response.text).toContain('playoffchallenge://stripe/complete');
      expect(response.text).toContain('Setup Complete');
      expect(response.text).toContain('Returning to app');
    });

    test('should include spinner and fallback button in HTML', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.text).toContain('class="spinner"');
      expect(response.text).toContain('fallback-button');
      expect(response.text).toContain('Open App');
    });
  });

  describe('GET /api/stripe/connect/status', () => {
    test('should return connected status with full account details', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440002';

      // Mock user query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            stripe_connected_account_id: 'acct_xxx'
          }
        ]
      });

      // Mock Stripe account retrieve
      stripeAccountsRetrieveStub.mockResolvedValueOnce({
        id: 'acct_xxx',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true
      });

      const response = await request(app)
        .get('/api/stripe/connect/status')
        .set('X-User-Id', userId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        connected: true,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true
      });
    });

    test('should return connected: false when no account', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440003';

      // Mock user query - no stripe_connected_account_id
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            stripe_connected_account_id: null
          }
        ]
      });

      const response = await request(app)
        .get('/api/stripe/connect/status')
        .set('X-User-Id', userId);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        connected: false
      });
      // Verify Stripe was NOT called
      expect(stripeAccountsRetrieveStub).not.toHaveBeenCalled();
    });

    test('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/stripe/connect/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });
  });
});
