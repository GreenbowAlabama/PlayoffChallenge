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

    it('should throw for invalid APP_ENV (no silent fallback)', () => {
      process.env.APP_ENV = 'invalid';
      const config = require('../../config');
      expect(() => config.getAppEnv()).toThrow('Invalid APP_ENV: "invalid"');
    });

    it.each(['dev', 'test', 'stg', 'prd'])('should accept valid env: %s', (env) => {
      process.env.APP_ENV = env;
      const config = require('../../config');
      expect(config.getAppEnv()).toBe(env);
    });
  });

  // NOTE: getJoinBaseUrl and buildJoinUrl moved to appConfig.js (see appConfig tests)

  describe('buildJoinUrl (via appConfig)', () => {
    beforeEach(() => {
      process.env.APP_BASE_URL = 'https://app.67enterprises.com';
    });

    it('should build full join URL from token', () => {
      delete require.cache[require.resolve('../../config/appConfig')];
      const appConfig = require('../../config/appConfig');
      const url = appConfig.buildJoinUrl('dev_abc123');
      expect(url).toBe('https://app.67enterprises.com/join/dev_abc123');
    });

    it('should throw if token is missing', () => {
      delete require.cache[require.resolve('../../config/appConfig')];
      const appConfig = require('../../config/appConfig');
      expect(() => appConfig.buildJoinUrl(null)).toThrow('token is required');
      expect(() => appConfig.buildJoinUrl('')).toThrow('token is required');
      expect(() => appConfig.buildJoinUrl(undefined)).toThrow('token is required');
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

  describe('getAppStoreUrl', () => {
    it('should return default App Store URL', () => {
      delete process.env.APP_STORE_URL;
      const config = require('../../config');
      expect(config.getAppStoreUrl()).toBe('https://apps.apple.com/us/app/fantasy-playoffs/id6754228835');
    });

    it('should return APP_STORE_URL if set', () => {
      process.env.APP_STORE_URL = 'https://apps.apple.com/app/custom/id123';
      const config = require('../../config');
      expect(config.getAppStoreUrl()).toBe('https://apps.apple.com/app/custom/id123');
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

  describe('validateEnvironment', () => {
    it('should pass for valid APP_ENV', () => {
      process.env.APP_ENV = 'stg';
      const config = require('../../config');
      expect(() => config.validateEnvironment()).not.toThrow();
    });

    it.each(['dev', 'test', 'stg', 'prd'])('should accept valid APP_ENV: %s', (env) => {
      process.env.APP_ENV = env;
      const config = require('../../config');
      expect(() => config.validateEnvironment()).not.toThrow();
    });

    it('should throw for invalid APP_ENV', () => {
      process.env.APP_ENV = 'banana';
      const config = require('../../config');
      expect(() => config.validateEnvironment()).toThrow('[STARTUP FATAL] Invalid APP_ENV: "banana"');
    });

    it('should throw when APP_ENV missing in production', () => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'production';
      const config = require('../../config');
      expect(() => config.validateEnvironment()).toThrow('APP_ENV is required in production');
    });

    it('should warn but not throw when APP_ENV missing in development', () => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'development';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const config = require('../../config');
      expect(() => config.validateEnvironment()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('APP_ENV is not set')
      );
      warnSpy.mockRestore();
    });

    it('should not warn when APP_ENV missing in test environment', () => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'test';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const config = require('../../config');
      expect(() => config.validateEnvironment()).not.toThrow();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
