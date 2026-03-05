/**
 * PGA Lock Time Derivation Tests
 *
 * Tests for extracting the earliest competitor tee time from ESPN API data
 * and deriving lock_time and tournament_start_time from it.
 */

'use strict';

const adapter = require('../../services/ingestion/strategies/pgaEspnIngestion');

describe('PGA Lock Time Derivation', () => {
  describe('extractEarliestTeeTime', () => {
    it('should extract earliest tee time from competitor data', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    displayName: 'Rory McIlroy',
                    startTime: '2024-04-11T12:30:00Z'
                  },
                  {
                    id: '2506',
                    displayName: 'Collin Morikawa',
                    startTime: '2024-04-11T12:40:00Z'
                  },
                  {
                    id: '1000',
                    displayName: 'Early Starter',
                    startTime: '2024-04-11T08:00:00Z'
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toBeDefined();
      expect(result).toEqual(new Date('2024-04-11T08:00:00Z'));
    });

    it('should return null if no competitors have startTime', () => {
      const espnPayload = {
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

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toBeNull();
    });

    it('should return null if competitors array is empty', () => {
      const espnPayload = {
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

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toBeNull();
    });

    it('should skip competitors with invalid or null startTime', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  {
                    id: '3470',
                    displayName: 'Rory McIlroy',
                    startTime: null
                  },
                  {
                    id: '2506',
                    displayName: 'Collin Morikawa',
                    startTime: '2024-04-11T10:00:00Z'
                  },
                  {
                    id: '1000',
                    displayName: 'Invalid Starter',
                    startTime: 'not-a-date'
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toEqual(new Date('2024-04-11T10:00:00Z'));
    });

    it('should handle missing events array gracefully', () => {
      const espnPayload = {
        // missing events array
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toBeNull();
    });

    it('should handle missing competitions array gracefully', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941'
            // missing competitions
          }
        ]
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toBeNull();
    });

    it('should return earliest time when multiple valid times exist', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2024-04-11T12:00:00Z' },
                  { id: '2', startTime: '2024-04-11T09:00:00Z' },
                  { id: '3', startTime: '2024-04-11T15:00:00Z' },
                  { id: '4', startTime: '2024-04-11T06:30:00Z' }
                ]
              }
            ]
          }
        ]
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      expect(result).toEqual(new Date('2024-04-11T06:30:00Z'));
    });

    it('should preserve UTC timezone when extracting tee time', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2024-04-11T08:00:00Z' }
                ]
              }
            ]
          }
        ]
      };

      const result = adapter.extractEarliestTeeTime(espnPayload);
      // Verify it's in UTC (no conversion to Central Time)
      expect(result.toISOString()).toBe('2024-04-11T08:00:00.000Z');
    });
  });

  describe('deriveLockTimeFromProviderData', () => {
    it('should derive lock_time from earliest tee time when available', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', startTime: '2024-04-11T08:00:00Z' },
                  { id: '2', startTime: '2024-04-11T12:00:00Z' }
                ]
              }
            ]
          }
        ]
      };

      const fallbackEventDate = new Date('2024-04-10T23:00:00Z'); // Broadcast time

      const result = adapter.deriveLockTimeFromProviderData(espnPayload, fallbackEventDate);
      expect(result.lockTime).toEqual(new Date('2024-04-11T08:00:00Z'));
      expect(result.source).toBe('competitor_tee_time');
    });

    it('should fallback to event.date if no competitor tee times', () => {
      const espnPayload = {
        events: [
          {
            id: '401811941',
            competitions: [
              {
                competitors: [
                  { id: '1', displayName: 'Player 1' } // no startTime
                ]
              }
            ]
          }
        ]
      };

      const fallbackEventDate = new Date('2024-04-10T23:00:00Z');

      const result = adapter.deriveLockTimeFromProviderData(espnPayload, fallbackEventDate);
      expect(result.lockTime).toEqual(fallbackEventDate);
      expect(result.source).toBe('fallback_event_date');
    });

    it('should handle null payload gracefully', () => {
      const fallbackEventDate = new Date('2024-04-10T23:00:00Z');

      const result = adapter.deriveLockTimeFromProviderData(null, fallbackEventDate);
      expect(result.lockTime).toEqual(fallbackEventDate);
      expect(result.source).toBe('fallback_event_date');
    });
  });
});
