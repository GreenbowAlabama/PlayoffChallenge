/**
 * Tests for Stripe fallback page (GET /api/stripe/complete)
 */

const request = require('supertest');
const express = require('express');
const stripeRoutes = require('../../routes/stripe.routes');

describe('Stripe Fallback Page', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/stripe', stripeRoutes);
  });

  describe('GET /api/stripe/complete', () => {
    it('should return HTML fallback page for post-onboarding redirect', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.type).toContain('text/html');
      expect(response.text).toContain('Setup Complete');
      expect(response.text).toContain('playoffchallenge://stripe/complete');
    });

    it('should include automatic deep link redirect attempt', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.text).toContain('window.location.href');
      expect(response.text).toContain('playoffchallenge://stripe/complete');
    });

    it('should include fallback button for web users', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Open App');
      expect(response.text).toContain('fallback-button');
    });

    it('should include loading state UI', async () => {
      const response = await request(app).get('/api/stripe/complete');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Returning to app');
      expect(response.text).toContain('class="spinner"');
    });

    it('should be accessible without authentication', async () => {
      const response = await request(app).get('/api/stripe/complete');

      // Fallback page should not require auth (user already completed Stripe onboarding)
      expect(response.status).toBe(200);
      expect(response.status).not.toBe(401);
    });
  });
});
