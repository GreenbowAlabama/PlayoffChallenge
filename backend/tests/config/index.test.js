/**
 * Config Module Unit Tests
 *
 * Tests centralized configuration module functionality.
 */

const config = require('../../config');

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getAppEnv', () => {
    it('should return dev by default', () => {
      delete process.env.APP_ENV;
      const config = require('../../config');
      expect(config.getAppEnv()).toBe('dev');
    });

    it('should return APP_ENV if valid', () => {
      process.env.APP_ENV = 'prd';
      const config = require('../../config');
      expect(config.getAppEnv()).toBe('prd');
    });

    it('should return dev for invalid APP_ENV', () => {
      process.env.APP_ENV = 'invalid';
      const config = require('../../config');
      expect(config.getAppEnv()).toBe('dev');
    });

    it.each(['dev', 'test', 'stg', 'prd'])('should accept valid env: %s', (env) => {
      process.env.APP_ENV = env;
      const config = require('../../config');
      expect(config.getAppEnv()).toBe(env);
    });
  });

  describe('getJoinBaseUrl', () => {
    it('should return JOIN_BASE_URL if set', () => {
      process.env.JOIN_BASE_URL = 'https://custom.example.com';
      const config = require('../../config');
      expect(config.getJoinBaseUrl()).toBe('https://custom.example.com');
    });

    it('should throw error if not set', () => {
      delete process.env.JOIN_BASE_URL;
      const config = require('../../config');
      expect(() => config.getJoinBaseUrl()).toThrow('JOIN_BASE_URL environment variable is required');
    });

    it('should remove trailing slash from URL', () => {
      process.env.JOIN_BASE_URL = 'https://example.com/';
      const config = require('../../config');
      expect(config.getJoinBaseUrl()).toBe('https://example.com');
    });
  });

  describe('buildJoinUrl', () => {
    beforeEach(() => {
      process.env.JOIN_BASE_URL = 'https://app.playoffchallenge.com';
    });

    it('should build full join URL from token', () => {
      const config = require('../../config');
      const url = config.buildJoinUrl('dev_abc123');
      expect(url).toBe('https://app.playoffchallenge.com/join/dev_abc123');
    });

    it('should throw if token is missing', () => {
      const config = require('../../config');
      expect(() => config.buildJoinUrl(null)).toThrow('Token is required');
      expect(() => config.buildJoinUrl('')).toThrow('Token is required');
      expect(() => config.buildJoinUrl(undefined)).toThrow('Token is required');
    });
  });

  describe('getJoinRateLimitConfig', () => {
    it('should return default values', () => {
      delete process.env.JOIN_RATE_LIMIT_WINDOW_MS;
      delete process.env.JOIN_RATE_LIMIT_MAX;
      delete process.env.JOIN_RATE_LIMIT_MAX_PER_TOKEN;

      const config = require('../../config');
      const rateLimitConfig = config.getJoinRateLimitConfig();

      expect(rateLimitConfig.windowMs).toBe(15 * 60 * 1000);
      expect(rateLimitConfig.maxAttempts).toBe(50);
      expect(rateLimitConfig.maxAttemptsPerToken).toBe(20);
    });

    it('should use environment overrides', () => {
      process.env.JOIN_RATE_LIMIT_WINDOW_MS = '60000';
      process.env.JOIN_RATE_LIMIT_MAX = '100';
      process.env.JOIN_RATE_LIMIT_MAX_PER_TOKEN = '10';

      const config = require('../../config');
      const rateLimitConfig = config.getJoinRateLimitConfig();

      expect(rateLimitConfig.windowMs).toBe(60000);
      expect(rateLimitConfig.maxAttempts).toBe(100);
      expect(rateLimitConfig.maxAttemptsPerToken).toBe(10);
    });
  });

  describe('environment detection', () => {
    it('isProduction should return true for production', () => {
      process.env.NODE_ENV = 'production';
      const config = require('../../config');
      expect(config.isProduction()).toBe(true);
    });

    it('isProduction should return false for development', () => {
      process.env.NODE_ENV = 'development';
      const config = require('../../config');
      expect(config.isProduction()).toBe(false);
    });

    it('getNodeEnv should default to development', () => {
      delete process.env.NODE_ENV;
      const config = require('../../config');
      expect(config.getNodeEnv()).toBe('development');
    });
  });
});
