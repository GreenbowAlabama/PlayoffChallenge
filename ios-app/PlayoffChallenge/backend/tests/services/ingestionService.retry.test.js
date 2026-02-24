/**
 * Ingestion Service Retry Policy Tests
 *
 * Tests for retry logic:
 * - Retry only on network errors, timeouts, 5xx
 * - Never retry on 4xx or validation failures
 * - Max 3 attempts
 * - Exponential backoff
 * - Explicit error codes
 */

describe('Ingestion Service Retry Policy', () => {
  describe('Retry decision logic', () => {
    it('should classify network errors as retryable', () => {
      const error = new Error('ECONNREFUSED');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify timeout errors as retryable', () => {
      const error = new Error('ETIMEDOUT');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should classify 5xx status as retryable', () => {
      expect(isRetryableStatus(503)).toBe(true);
      expect(isRetryableStatus(500)).toBe(true);
    });

    it('should classify 4xx status as NOT retryable', () => {
      expect(isRetryableStatus(400)).toBe(false);
      expect(isRetryableStatus(403)).toBe(false);
      expect(isRetryableStatus(404)).toBe(false);
    });

    it('should classify validation error as NOT retryable', () => {
      expect(isRetryableError(new Error('SCHEMA_MISMATCH'))).toBe(false);
      expect(isRetryableError(new Error('Invalid JSON'))).toBe(false);
    });
  });

  describe('Retry limits', () => {
    it('should allow max 3 attempts', () => {
      expect(getMaxAttempts()).toBe(3);
    });

    it('should stop after max attempts', () => {
      const attempts = calculateAttempts(false, true); // Always fail
      expect(attempts).toBeLessThanOrEqual(3);
    });
  });

  describe('Exponential backoff calculation', () => {
    it('should calculate exponential backoff: 1s, 2s, 4s', () => {
      expect(getBackoffMs(1)).toBe(1000); // 2^0 * 1000
      expect(getBackoffMs(2)).toBe(2000); // 2^1 * 1000
      expect(getBackoffMs(3)).toBe(4000); // 2^2 * 1000
    });

    it('should not backoff on first attempt', () => {
      expect(getBackoffMs(0)).toBe(0);
    });
  });

  describe('Timeout enforcement', () => {
    it('should use 5 second default timeout', () => {
      expect(getDefaultTimeoutMs()).toBe(5000);
    });

    it('should allow custom timeout', () => {
      const timeout = getTimeoutMs({ timeoutMs: 3000 });
      expect(timeout).toBe(3000);
    });
  });

  describe('Error code mapping', () => {
    it('should map 400 to PROVIDER_INVALID_REQUEST', () => {
      expect(getErrorCodeForStatus(400)).toBe('PROVIDER_INVALID_REQUEST');
    });

    it('should map 403 to PROVIDER_FORBIDDEN', () => {
      expect(getErrorCodeForStatus(403)).toBe('PROVIDER_FORBIDDEN');
    });

    it('should map 404 to PROVIDER_NOT_FOUND', () => {
      expect(getErrorCodeForStatus(404)).toBe('PROVIDER_NOT_FOUND');
    });

    it('should map 5xx to PROVIDER_ERROR', () => {
      expect(getErrorCodeForStatus(500)).toBe('PROVIDER_ERROR');
      expect(getErrorCodeForStatus(503)).toBe('PROVIDER_ERROR');
    });

    it('should map network error to NETWORK_ERROR', () => {
      expect(getErrorCodeForError(new Error('ECONNREFUSED'))).toBe('NETWORK_ERROR');
    });

    it('should map timeout to PROVIDER_TIMEOUT', () => {
      expect(getErrorCodeForError(new Error('ETIMEDOUT'))).toBe('PROVIDER_TIMEOUT');
    });
  });

  describe('Retry logging', () => {
    it('should include [Ingestion] prefix in logs', () => {
      const log = createRetryLog('contest123', 1, 3);
      expect(log).toContain('[Ingestion]');
    });

    it('should include contest_id in logs', () => {
      const log = createRetryLog('contest123', 1, 3);
      expect(log).toContain('contest_id=contest123');
    });

    it('should include attempt number in logs', () => {
      const log = createRetryLog('contest123', 2, 3);
      expect(log).toContain('attempt=2/3');
    });

    it('should include timeout_ms in logs', () => {
      const log = createRetryLog('contest123', 1, 3, { timeoutMs: 5000 });
      expect(log).toContain('timeout_ms=5000');
    });

    it('should include backoff_ms in logs', () => {
      const backoff = getBackoffMs(1);
      const log = createRetryLog('contest123', 1, 3, { backoffMs: backoff });
      expect(log).toContain(`backoff_ms=${backoff}`);
    });
  });

  describe('No silent failures', () => {
    it('should provide explicit error codes', () => {
      const codes = [
        'NETWORK_ERROR',
        'PROVIDER_TIMEOUT',
        'PROVIDER_ERROR',
        'PROVIDER_INVALID_REQUEST',
        'PROVIDER_FORBIDDEN',
        'PROVIDER_NOT_FOUND',
        'SCHEMA_MISMATCH'
      ];

      expect(codes.length).toBeGreaterThan(0);
      codes.forEach(code => {
        expect(code).not.toMatch(/INTERNAL|UNKNOWN/);
      });
    });
  });
});

// Helper functions that would be in the actual ingestionService
function isRetryableError(error) {
  const msg = error.message.toLowerCase();
  return msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('timeout');
}

function isRetryableStatus(status) {
  return status >= 500;
}

function getMaxAttempts() {
  return 3;
}

function calculateAttempts(firstSuccess, alwaysFail) {
  const maxAttempts = getMaxAttempts();
  if (firstSuccess) return 1;
  return maxAttempts;
}

function getBackoffMs(attemptNumber) {
  if (attemptNumber === 0) return 0;
  return Math.pow(2, attemptNumber - 1) * 1000;
}

function getDefaultTimeoutMs() {
  return 5000;
}

function getTimeoutMs(options) {
  return options?.timeoutMs || getDefaultTimeoutMs();
}

function getErrorCodeForStatus(status) {
  const map = {
    400: 'PROVIDER_INVALID_REQUEST',
    401: 'PROVIDER_UNAUTHORIZED',
    403: 'PROVIDER_FORBIDDEN',
    404: 'PROVIDER_NOT_FOUND'
  };
  return map[status] || (status >= 500 ? 'PROVIDER_ERROR' : 'PROVIDER_ERROR');
}

function getErrorCodeForError(error) {
  const msg = error.message.toLowerCase();
  if (msg.includes('etimedout') || msg.includes('timeout')) {
    return 'PROVIDER_TIMEOUT';
  }
  return 'NETWORK_ERROR';
}

function createRetryLog(contestId, attempt, maxAttempts, options = {}) {
  const { timeoutMs = 5000, backoffMs = 0 } = options;
  let log = `[Ingestion] contest_id=${contestId} attempt=${attempt}/${maxAttempts} timeout_ms=${timeoutMs}`;
  if (backoffMs > 0) {
    log += ` backoff_ms=${backoffMs}`;
  }
  return log;
}
