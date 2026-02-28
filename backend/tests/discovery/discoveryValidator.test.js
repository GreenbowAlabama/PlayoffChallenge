/**
 * Discovery Validator Tests
 *
 * Zero clock dependence: All tests use injected `now` parameter.
 * Deterministic: Every test can be replayed with identical results.
 * Exhaustive: Every rejection path is tested explicitly.
 */

const {
  validateDiscoveryInput,
  normalizeToDate,
  getErrorDetails,
  ALLOWED_PROVIDER_STATUSES,
  DISCOVERY_WINDOW_DAYS,
  DISCOVERY_WINDOW_MS
} = require('../../services/discovery/discoveryValidator');

describe('discoveryValidator', () => {
  // Fixed test time: 2026-03-01 12:00:00 UTC
  const now = new Date('2026-03-01T12:00:00Z');

  // Convenience: valid input template
  const validInput = {
    provider_tournament_id: 'pga_us_open_2026',
    season_year: 2026,
    name: 'PGA US Open 2026',
    start_time: new Date('2026-03-15T08:00:00Z'),
    end_time: new Date('2026-03-18T20:00:00Z'),
    status: 'SCHEDULED'
  };

  describe('normalizeToDate', () => {
    it('should accept valid Date object', () => {
      const date = new Date('2026-03-15T08:00:00Z');
      const result = normalizeToDate(date);
      expect(result.error).toBeNull();
      expect(result.date).toEqual(date);
    });

    it('should parse valid ISO 8601 string', () => {
      const isoString = '2026-03-15T08:00:00Z';
      const result = normalizeToDate(isoString);
      expect(result.error).toBeNull();
      expect(result.date).toEqual(new Date(isoString));
    });

    it('should reject invalid ISO string', () => {
      const result = normalizeToDate('not-a-date');
      expect(result.error).not.toBeNull();
      expect(result.date).toBeNull();
    });

    it('should reject invalid Date object', () => {
      const result = normalizeToDate(new Date('invalid'));
      expect(result.error).not.toBeNull();
      expect(result.date).toBeNull();
    });

    it('should reject null', () => {
      const result = normalizeToDate(null);
      expect(result.error).toBeNull();
      expect(result.date).toBeNull();
    });

    it('should reject undefined', () => {
      const result = normalizeToDate(undefined);
      expect(result.error).toBeNull();
      expect(result.date).toBeNull();
    });

    it('should reject non-string, non-Date types', () => {
      const result = normalizeToDate(12345);
      expect(result.error).not.toBeNull();
      expect(result.date).toBeNull();
    });
  });

  describe('validateDiscoveryInput', () => {
    describe('parameter validation', () => {
      it('should reject null input', () => {
        const result = validateDiscoveryInput(null, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_INPUT');
      });

      it('should reject non-object input', () => {
        const result = validateDiscoveryInput('not-an-object', now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_INPUT');
      });

      it('should reject invalid now parameter', () => {
        const result = validateDiscoveryInput(validInput, new Date('invalid'));
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_NOW_PARAMETER');
      });

      it('should reject non-Date now parameter', () => {
        const result = validateDiscoveryInput(validInput, '2026-03-01');
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_NOW_PARAMETER');
      });
    });

    describe('provider_tournament_id validation', () => {
      it('should reject missing provider_tournament_id', () => {
        const input = { ...validInput, provider_tournament_id: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_PROVIDER_TOURNAMENT_ID');
      });

      it('should reject empty provider_tournament_id', () => {
        const input = { ...validInput, provider_tournament_id: '' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_PROVIDER_TOURNAMENT_ID');
      });

      it('should reject whitespace-only provider_tournament_id', () => {
        const input = { ...validInput, provider_tournament_id: '   ' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_PROVIDER_TOURNAMENT_ID');
      });

      it('should trim whitespace from provider_tournament_id', () => {
        const input = { ...validInput, provider_tournament_id: '  pga_masters_2026  ' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.provider_tournament_id).toBe('pga_masters_2026');
      });

      it('should reject non-string provider_tournament_id', () => {
        const input = { ...validInput, provider_tournament_id: 12345 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_PROVIDER_TOURNAMENT_ID');
      });
    });

    describe('season_year validation', () => {
      it('should reject missing season_year', () => {
        const input = { ...validInput, season_year: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_SEASON_YEAR');
      });

      it('should reject non-integer season_year', () => {
        const input = { ...validInput, season_year: 2026.5 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_SEASON_YEAR');
      });

      it('should reject season_year < 2000', () => {
        const input = { ...validInput, season_year: 1999 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_SEASON_YEAR');
      });

      it('should reject season_year > 2099', () => {
        const input = { ...validInput, season_year: 2100 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_SEASON_YEAR');
      });

      it('should accept season_year 2000', () => {
        const input = { ...validInput, season_year: 2000 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });

      it('should accept season_year 2099', () => {
        const input = { ...validInput, season_year: 2099 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });
    });

    describe('name validation', () => {
      it('should reject missing name', () => {
        const input = { ...validInput, name: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_TOURNAMENT_NAME');
      });

      it('should reject empty name', () => {
        const input = { ...validInput, name: '' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_TOURNAMENT_NAME');
      });

      it('should reject whitespace-only name', () => {
        const input = { ...validInput, name: '   ' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_TOURNAMENT_NAME');
      });

      it('should trim whitespace from name', () => {
        const input = { ...validInput, name: '  PGA Masters 2026  ' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.name).toBe('PGA Masters 2026');
      });

      it('should reject non-string name', () => {
        const input = { ...validInput, name: 12345 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_TOURNAMENT_NAME');
      });
    });

    describe('start_time validation', () => {
      it('should reject missing start_time', () => {
        const input = { ...validInput, start_time: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_START_TIME');
      });

      it('should reject null start_time', () => {
        const input = { ...validInput, start_time: null };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_START_TIME');
      });

      it('should reject invalid start_time string', () => {
        const input = { ...validInput, start_time: 'not-a-date' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_START_TIME');
      });

      it('should reject invalid Date for start_time', () => {
        const input = { ...validInput, start_time: new Date('invalid') };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_START_TIME');
      });

      it('should accept ISO string for start_time', () => {
        const input = { ...validInput, start_time: '2026-03-15T08:00:00Z' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.start_time).toEqual(new Date('2026-03-15T08:00:00Z'));
      });
    });

    describe('end_time validation', () => {
      it('should reject missing end_time', () => {
        const input = { ...validInput, end_time: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_END_TIME');
      });

      it('should reject null end_time', () => {
        const input = { ...validInput, end_time: null };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_END_TIME');
      });

      it('should reject invalid end_time string', () => {
        const input = { ...validInput, end_time: 'not-a-date' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_END_TIME');
      });
    });

    describe('time range validation', () => {
      it('should reject end_time equal to start_time', () => {
        const time = new Date('2026-03-15T08:00:00Z');
        const input = { ...validInput, start_time: time, end_time: time };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_TIME_RANGE');
      });

      it('should reject end_time before start_time', () => {
        const input = {
          ...validInput,
          start_time: new Date('2026-03-18T20:00:00Z'),
          end_time: new Date('2026-03-15T08:00:00Z')
        };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_TIME_RANGE');
      });

      it('should accept end_time strictly after start_time', () => {
        const input = {
          ...validInput,
          start_time: new Date('2026-03-15T08:00:00Z'),
          end_time: new Date('2026-03-15T08:00:00.001Z')
        };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });
    });

    describe('status validation', () => {
      it('should reject missing status', () => {
        const input = { ...validInput, status: undefined };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_STATUS');
      });

      it('should reject null status', () => {
        const input = { ...validInput, status: null };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_STATUS');
      });

      it('should reject non-string status', () => {
        const input = { ...validInput, status: 123 };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('MISSING_STATUS');
      });

      it('should reject invalid status', () => {
        const input = { ...validInput, status: 'INVALID_STATUS' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('INVALID_TOURNAMENT_STATUS');
      });

      it('should accept lowercase scheduled', () => {
        const input = { ...validInput, status: 'scheduled' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.status).toBe('SCHEDULED');
      });

      it('should accept SCHEDULED status', () => {
        const input = { ...validInput, status: 'SCHEDULED' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.status).toBe('SCHEDULED');
      });

      it('should accept CANCELLED status', () => {
        const input = { ...validInput, status: 'CANCELLED' };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
        expect(result.normalizedInput.status).toBe('CANCELLED');
      });

      it('should have exactly 2 allowed statuses', () => {
        expect(ALLOWED_PROVIDER_STATUSES).toEqual(['SCHEDULED', 'CANCELLED']);
      });
    });

    describe('discovery window validation', () => {
      it('should reject tournament before window start', () => {
        // Window: now ± 90 days
        // now = 2026-03-01
        // window start = 2025-12-01
        const beforeWindow = new Date('2025-11-30T23:59:59Z');
        const input = { ...validInput, start_time: beforeWindow, end_time: new Date(beforeWindow.getTime() + 86400000) };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('OUTSIDE_DISCOVERY_WINDOW');
      });

      it('should reject tournament after window end', () => {
        // Window: now ± 90 days
        // now = 2026-03-01
        // window end = 2026-05-31
        const afterWindow = new Date('2026-06-01T00:00:00Z');
        const input = { ...validInput, start_time: afterWindow, end_time: new Date(afterWindow.getTime() + 86400000) };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe('OUTSIDE_DISCOVERY_WINDOW');
      });

      it('should accept tournament at window start boundary', () => {
        // Exact start: now - 90 days
        const windowStart = new Date(now.getTime() - DISCOVERY_WINDOW_MS);
        const input = { ...validInput, start_time: windowStart, end_time: new Date(windowStart.getTime() + 86400000) };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });

      it('should accept tournament at window end boundary', () => {
        // Exact end: now + 90 days
        const windowEnd = new Date(now.getTime() + DISCOVERY_WINDOW_MS);
        const input = { ...validInput, start_time: windowEnd, end_time: new Date(windowEnd.getTime() + 86400000) };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });

      it('should accept tournament inside window', () => {
        const input = {
          ...validInput,
          start_time: new Date(now.getTime() + 86400000 * 30), // 30 days from now
          end_time: new Date(now.getTime() + 86400000 * 35)
        };
        const result = validateDiscoveryInput(input, now);
        expect(result.valid).toBe(true);
      });
    });

    describe('successful validation', () => {
      it('should return valid true with normalized input', () => {
        const result = validateDiscoveryInput(validInput, now);
        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();
        expect(result.errorCode).toBeNull();
        expect(result.normalizedInput).not.toBeNull();
      });

      it('should normalize Date objects in output', () => {
        const input = {
          ...validInput,
          start_time: '2026-03-15T08:00:00Z',
          end_time: new Date('2026-03-18T20:00:00Z')
        };
        const result = validateDiscoveryInput(input, now);
        expect(result.normalizedInput.start_time instanceof Date).toBe(true);
        expect(result.normalizedInput.end_time instanceof Date).toBe(true);
      });

      it('should normalize status to uppercase', () => {
        const input = { ...validInput, status: 'scheduled' };
        const result = validateDiscoveryInput(input, now);
        expect(result.normalizedInput.status).toBe('SCHEDULED');
      });

      it('should be deterministic (same input → same output)', () => {
        const result1 = validateDiscoveryInput(validInput, now);
        const result2 = validateDiscoveryInput(validInput, now);
        expect(result1).toEqual(result2);
      });

      it('should be replay-safe (injected now)', () => {
        const fixedTime = new Date('2026-03-01T12:00:00Z');
        const result1 = validateDiscoveryInput(validInput, fixedTime);
        const result2 = validateDiscoveryInput(validInput, fixedTime);
        expect(result1.normalizedInput).toEqual(result2.normalizedInput);
      });
    });

    describe('error message clarity', () => {
      it('should provide clear error messages', () => {
        const input = { ...validInput, season_year: 1999 };
        const result = validateDiscoveryInput(input, now);
        expect(result.error).toContain('2000');
        expect(result.error).toContain('2099');
      });

      it('should include received value in error for status', () => {
        const input = { ...validInput, status: 'INVALID' };
        const result = validateDiscoveryInput(input, now);
        expect(result.error).toContain('INVALID');
      });
    });
  });

  describe('getErrorDetails', () => {
    it('should map MISSING_PROVIDER_TOURNAMENT_ID to 400', () => {
      const details = getErrorDetails('MISSING_PROVIDER_TOURNAMENT_ID');
      expect(details.statusCode).toBe(400);
      expect(details.message).toBeDefined();
    });

    it('should map INVALID_NOW_PARAMETER to 500', () => {
      const details = getErrorDetails('INVALID_NOW_PARAMETER');
      expect(details.statusCode).toBe(500);
    });

    it('should return 500 for unknown error codes', () => {
      const details = getErrorDetails('UNKNOWN_ERROR');
      expect(details.statusCode).toBe(500);
    });

    it('should have error mapping for all known error codes', () => {
      const knownCodes = [
        'INVALID_INPUT',
        'INVALID_NOW_PARAMETER',
        'MISSING_PROVIDER_TOURNAMENT_ID',
        'INVALID_SEASON_YEAR',
        'MISSING_TOURNAMENT_NAME',
        'MISSING_START_TIME',
        'INVALID_START_TIME',
        'MISSING_END_TIME',
        'INVALID_END_TIME',
        'INVALID_TIME_RANGE',
        'MISSING_STATUS',
        'INVALID_TOURNAMENT_STATUS',
        'OUTSIDE_DISCOVERY_WINDOW'
      ];

      knownCodes.forEach(code => {
        const details = getErrorDetails(code);
        expect(details.statusCode).toBeGreaterThanOrEqual(400);
        expect(details.message).toBeDefined();
        expect(details.message.length).toBeGreaterThan(0);
      });
    });
  });
});
