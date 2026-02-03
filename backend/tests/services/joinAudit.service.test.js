/**
 * Join Audit Service Unit Tests
 *
 * Tests structured logging for join token operations.
 */

const joinAuditService = require('../../services/joinAuditService');

describe('Join Audit Service', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('redactToken', () => {
    it('should redact token showing prefix and last 4 chars', () => {
      const result = joinAuditService.redactToken('dev_abc123def456789012345678901234');
      expect(result).toBe('dev_...1234');
    });

    it('should return [invalid] for short tokens', () => {
      expect(joinAuditService.redactToken('abc')).toBe('[invalid]');
      expect(joinAuditService.redactToken('')).toBe('[invalid]');
      expect(joinAuditService.redactToken(null)).toBe('[invalid]');
    });

    it('should return [malformed] for tokens without underscore', () => {
      expect(joinAuditService.redactToken('nounderscore')).toBe('[malformed]');
    });

    it('should handle different environment prefixes', () => {
      expect(joinAuditService.redactToken('prd_xyz987654321')).toBe('prd_...4321');
      expect(joinAuditService.redactToken('stg_abcdefghij1234')).toBe('stg_...1234');
    });
  });

  describe('logJoinSuccess', () => {
    it('should log structured JSON with success result', () => {
      joinAuditService.logJoinSuccess({
        token: 'dev_abc123456789012345678901234567',
        contestId: 'contest-uuid',
        userId: 'user-uuid',
        ipAddress: '192.168.1.1',
        joinSource: 'universal_link'
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.mock.calls[0];
      expect(logCall[0]).toBe('[Join Audit]');

      const logEntry = JSON.parse(logCall[1]);
      expect(logEntry.event).toBe('join_attempt');
      expect(logEntry.result).toBe('success');
      expect(logEntry.token_id).toBe('dev_...4567');
      expect(logEntry.contest_id).toBe('contest-uuid');
      expect(logEntry.user_id).toBe('user-uuid');
      expect(logEntry.ip_address).toBe('192.168.1.1');
      expect(logEntry.join_source).toBe('universal_link');
      expect(logEntry.timestamp).toBeDefined();
    });
  });

  describe('logJoinFailure', () => {
    it('should log structured JSON with failure result', () => {
      joinAuditService.logJoinFailure({
        token: 'prd_invalidtoken123456789012345',
        errorCode: 'ENVIRONMENT_MISMATCH',
        ipAddress: '10.0.0.1',
        extra: { token_environment: 'prd', current_environment: 'dev' }
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.event).toBe('join_attempt');
      expect(logEntry.result).toBe('failure');
      expect(logEntry.error_code).toBe('ENVIRONMENT_MISMATCH');
      expect(logEntry.extra.token_environment).toBe('prd');
      expect(logEntry.extra.current_environment).toBe('dev');
    });

    it('should handle missing optional fields', () => {
      joinAuditService.logJoinFailure({
        token: 'dev_sometoken1234567890123456789',
        errorCode: 'NOT_FOUND'
      });

      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.result).toBe('failure');
      expect(logEntry.error_code).toBe('NOT_FOUND');
      expect(logEntry.user_id).toBeNull();
      expect(logEntry.ip_address).toBeNull();
      expect(logEntry.join_source).toBe('universal_link');
    });
  });

  describe('logJoinRateLimited', () => {
    it('should log rate limited event', () => {
      joinAuditService.logJoinRateLimited({
        token: 'dev_ratelimitedtoken12345678901',
        ipAddress: '1.2.3.4',
        limitType: 'ip'
      });

      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.event).toBe('join_rate_limited');
      expect(logEntry.result).toBe('rate_limited');
      expect(logEntry.limit_type).toBe('ip');
      expect(logEntry.ip_address).toBe('1.2.3.4');
    });

    it('should handle token-based rate limiting', () => {
      joinAuditService.logJoinRateLimited({
        token: 'dev_bruteforcedtoken1234567890',
        ipAddress: '5.6.7.8',
        limitType: 'token'
      });

      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.limit_type).toBe('token');
    });
  });

  describe('logJoinAttempt', () => {
    it('should default join_source to universal_link', () => {
      joinAuditService.logJoinAttempt({
        token: 'dev_defaultsourcetoken123456789',
        result: 'success'
      });

      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.join_source).toBe('universal_link');
    });

    it('should include all provided fields', () => {
      joinAuditService.logJoinAttempt({
        token: 'dev_fullentry1234567890123456789',
        contestId: 'contest-123',
        userId: 'user-456',
        joinSource: 'qr_code',
        ipAddress: '10.10.10.10',
        result: 'success',
        extra: { device: 'iPhone' }
      });

      const logCall = consoleSpy.mock.calls[0];
      const logEntry = JSON.parse(logCall[1]);

      expect(logEntry.join_source).toBe('qr_code');
      expect(logEntry.extra.device).toBe('iPhone');
    });
  });
});
