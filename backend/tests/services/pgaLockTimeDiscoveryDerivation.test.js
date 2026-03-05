/**
 * PGA Lock Time Discovery Derivation Tests
 *
 * Tests for deriving lock_time from ESPN data during contest creation.
 * Uses mocked ESPN data — no real API calls.
 */

'use strict';

const pgaEspnIngestion = require('../../services/ingestion/strategies/pgaEspnIngestion');
const espnFetcher = require('../../services/discovery/espnDataFetcher');

describe('PGA Lock Time Discovery Derivation', () => {
  const fallbackTime = new Date('2026-04-09T07:00:00Z'); // Broadcast time from fixture

  describe('deriveLockTimeFromProviderData with mocked ESPN data', () => {
    it('should derive lock_time from earliest competitor teeTime', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    displayName: 'Rory McIlroy',
                    startTime: '2026-04-09T12:30:00Z'
                  },
                  {
                    id: '2506',
                    displayName: 'Collin Morikawa',
                    startTime: '2026-04-09T12:40:00Z'
                  },
                  {
                    id: '1000',
                    displayName: 'Early Starter',
                    startTime: '2026-04-09T08:00:00Z' // Earliest
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(new Date('2026-04-09T08:00:00Z'));
      expect(result.source).toBe('competitor_tee_time');
    });

    it('should fallback to fixture time when no competitors have teeTime', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    displayName: 'Rory McIlroy'
                    // no startTime
                  },
                  {
                    id: '2506',
                    displayName: 'Collin Morikawa'
                    // no startTime
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should fallback when competitors array is empty', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: []
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should fallback when events array is missing', () => {
      const malformedData = {
        // missing events
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        malformedData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should fallback when competitions array is missing', () => {
      const malformedData = {
        events: [
          {
            id: '401811941'
            // missing competitions
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        malformedData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should skip invalid startTime and use valid times', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '1',
                    startTime: 'not-a-date' // Invalid
                  },
                  {
                    id: '2',
                    startTime: null // Invalid
                  },
                  {
                    id: '3',
                    startTime: '2026-04-09T10:00:00Z' // Valid
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(new Date('2026-04-09T10:00:00Z'));
      expect(result.source).toBe('competitor_tee_time');
    });

    it('should handle null providerData gracefully', () => {
      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        null,
        fallbackTime
      );

      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should preserve UTC timezone in derived lock_time', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '1',
                    startTime: '2026-04-09T08:00:00Z'
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      // Verify ISO string ends with Z (UTC)
      expect(result.lockTime.toISOString()).toBe('2026-04-09T08:00:00.000Z');
    });

    it('should select earliest among multiple valid tee times (>= fixture)', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2026-04-09T12:00:00Z' },
                  { id: '2', startTime: '2026-04-09T09:00:00Z' },
                  { id: '3', startTime: '2026-04-09T15:00:00Z' },
                  { id: '4', startTime: '2026-04-09T08:00:00Z' } // >= fixture 07:00
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      expect(result.lockTime).toEqual(new Date('2026-04-09T08:00:00Z'));
      expect(result.source).toBe('competitor_tee_time');
    });

    it('should reject ESPN tee time earlier than fixture and fallback', () => {
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2026-04-09T06:30:00Z' } // Before fixture 07:00
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fallbackTime
      );

      // Should reject early ESPN time and use fixture instead
      expect(result.lockTime).toEqual(fallbackTime);
      expect(result.source).toBe('fallback_event_date');
    });
  });

  describe('extractEspnEventId utility', () => {
    it('should extract ESPN event ID from provider_event_id', () => {
      const providerId = 'espn_pga_401811941';
      const eventId = espnFetcher.extractEspnEventId(providerId);
      expect(eventId).toBe('401811941');
    });

    it('should return null for malformed provider_event_id', () => {
      const testCases = [
        'invalid_id',
        'espn_pga_abc',
        'espn_nfl_401811941',
        'espn_pga_'
      ];

      testCases.forEach(input => {
        expect(espnFetcher.extractEspnEventId(input)).toBeNull();
      });
    });

    it('should return null for null or non-string input', () => {
      expect(espnFetcher.extractEspnEventId(null)).toBeNull();
      expect(espnFetcher.extractEspnEventId(undefined)).toBeNull();
      expect(espnFetcher.extractEspnEventId(123)).toBeNull();
    });
  });

  describe('Discovery flow: fixture time vs derived ESPN time', () => {
    it('should show difference between fixture broadcast time and earliest tee time', () => {
      // Fixture: Masters Tournament startDate = 2026-04-09T07:00Z (broadcast time)
      const fixtureTime = new Date('2026-04-09T07:00:00Z');

      // ESPN: First golfer tees off at 8:00 AM UTC
      const mockEspnData = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2026-04-09T08:00:00Z' },
                  { id: '2', startTime: '2026-04-09T08:10:00Z' }
                ]
              }
            ]
          }
        ]
      };

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        mockEspnData,
        fixtureTime
      );

      // Derived lock_time should be the earliest tee time (8:00 AM), not broadcast time
      expect(result.lockTime.getTime()).toBeGreaterThan(fixtureTime.getTime());
      expect(result.lockTime).toEqual(new Date('2026-04-09T08:00:00Z'));
      expect(result.source).toBe('competitor_tee_time');
    });

    it('should fallback to fixture time if ESPN data unavailable', () => {
      const fixtureTime = new Date('2026-04-09T07:00:00Z');
      const malformedEspnData = null;

      const result = pgaEspnIngestion.deriveLockTimeFromProviderData(
        malformedEspnData,
        fixtureTime
      );

      expect(result.lockTime).toEqual(fixtureTime);
      expect(result.source).toBe('fallback_event_date');
    });
  });
});
