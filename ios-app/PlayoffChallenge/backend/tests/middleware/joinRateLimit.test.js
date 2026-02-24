/**
 * Join Rate Limit Middleware Tests
 *
 * Tests rate limiting functionality for join token endpoint.
 */

describe('Join Rate Limit Middleware', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.APP_ENV = 'dev';
  });

  afterEach(() => {
    delete process.env.APP_ENV;
  });

  describe('createJoinRateLimiter', () => {
    it('should initialize without throwing (IPv6 compatible)', () => {
      // This test verifies the fix for ERR_ERL_KEY_GEN_IPV6
      // The middleware should create successfully without validation errors
      expect(() => {
        const { createJoinRateLimiter } = require('../../middleware/joinRateLimit');
        const limiter = createJoinRateLimiter();
        expect(limiter).toBeDefined();
        expect(typeof limiter).toBe('function');
      }).not.toThrow();
    });
  });

  describe('createCombinedJoinRateLimiter', () => {
    it('should return array of middleware functions', () => {
      const { createCombinedJoinRateLimiter } = require('../../middleware/joinRateLimit');
      const limiters = createCombinedJoinRateLimiter();

      expect(Array.isArray(limiters)).toBe(true);
      expect(limiters.length).toBe(2);
      expect(typeof limiters[0]).toBe('function');
      expect(typeof limiters[1]).toBe('function');
    });
  });

  describe('perTokenRateLimiter', () => {
    it('should call next() when token is not present', () => {
      const { perTokenRateLimiter } = require('../../middleware/joinRateLimit');

      const req = { params: {} };
      const res = {};
      const next = jest.fn();

      perTokenRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should call next() for first request with token', () => {
      const { perTokenRateLimiter } = require('../../middleware/joinRateLimit');

      const req = {
        params: { token: 'dev_uniquetoken12345678901234' },
        ip: '192.168.1.1'
      };
      const res = {};
      const next = jest.fn();

      perTokenRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
