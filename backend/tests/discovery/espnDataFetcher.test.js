/**
 * ESPN Data Fetcher Tests
 *
 * Tests for:
 * - Scoreboard endpoint (correct endpoint for PGA)
 * - Event lookup by ID
 * - Tee time extraction format
 */

'use strict';

// Mock global fetch
global.fetch = jest.fn();

describe('ESPN Data Fetcher', () => {
  const { fetchEspnSummary, extractEspnEventId } = require('../../services/discovery/espnDataFetcher');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchEspnSummary', () => {
    it('should fetch from scoreboard endpoint (not summary endpoint)', async () => {
      const mockScoreboardResponse = {
        events: [
          {
            id: '401811937',
            name: 'The Masters',
            status: { type: { name: 'STATUS_IN_PROGRESS' } },
            competitions: [
              {
                competitors: [
                  {
                    id: 'player1',
                    startTime: '2026-03-15T08:00:00Z'
                  }
                ]
              }
            ]
          },
          {
            id: '401811938',
            name: 'Other Event',
            competitions: [{ competitors: [] }]
          }
        ]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockScoreboardResponse)
      });

      const result = await fetchEspnSummary('401811937');

      // Verify it called the scoreboard endpoint
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sports/golf/pga/scoreboard'),
        expect.any(Object)
      );

      // Verify it does NOT call summary endpoint
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/summary'),
        expect.any(Object)
      );

      // Verify the returned event is the first event (ignores parameter)
      expect(result).toBeDefined();
      expect(result.events).toBeDefined();
      expect(result.events[0].id).toBe('401811937');
      expect(result.events[0].name).toBe('The Masters');
      expect(result.events[0].competitions).toBeDefined();
    });

    it('should select the matching eventId from scoreboard', async () => {
      const requestedEventId = '401811938';
      const mockScoreboardResponse = {
        events: [
          {
            id: '401811937',
            name: 'Event 1',
            competitions: [{ competitors: [] }]
          },
          {
            id: requestedEventId,
            name: 'Event 2',
            competitions: [{ competitors: [{ startTime: '2026-03-16T08:00:00Z' }] }]
          },
          {
            id: '401811939',
            name: 'Event 3',
            competitions: [{ competitors: [] }]
          }
        ]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockScoreboardResponse)
      });

      // Pass eventId to fetch
      const result = await fetchEspnSummary(requestedEventId);

      // Should return the event matching the requested eventId
      expect(result).toBeDefined();
      expect(result.events[0].id).toBe(requestedEventId);
      expect(result.events[0].name).toBe('Event 2');
    });

    it('should return null if no events in scoreboard', async () => {
      const mockScoreboardResponse = {
        events: []
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockScoreboardResponse)
      });

      const result = await fetchEspnSummary('401811937');

      // Should return null when no events available
      expect(result).toBeNull();
    });

    it('should return null if fetch fails', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await fetchEspnSummary('401811937');

      expect(result).toBeNull();
    });

    it('should return null if response is invalid JSON', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockRejectedValueOnce(new Error('Invalid JSON'))
      });

      const result = await fetchEspnSummary('401811937');

      expect(result).toBeNull();
    });

    it('should return event payload with structure for lock time extraction', async () => {
      const mockScoreboardResponse = {
        events: [
          {
            id: '401811941',
            name: 'PGA Tournament',
            competitions: [
              {
                competitors: [
                  { startTime: '2026-03-15T08:00:00Z', id: 'p1' },
                  { startTime: '2026-03-15T08:06:00Z', id: 'p2' }
                ]
              }
            ]
          }
        ]
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce(mockScoreboardResponse)
      });

      const result = await fetchEspnSummary('401811941');

      // Verify structure is correct for extractEarliestTeeTime
      expect(result.events).toBeDefined();
      expect(result.events[0]).toBeDefined();
      expect(result.events[0].competitions).toBeDefined();
      expect(result.events[0].competitions[0].competitors).toBeDefined();
      expect(result.events[0].competitors).toBeUndefined(); // Should be nested under competitions
    });
  });

  describe('extractEspnEventId', () => {
    it('should extract event ID from espn_pga_ format', () => {
      const eventId = extractEspnEventId('espn_pga_401811941');
      expect(eventId).toBe('401811941');
    });

    it('should return null for invalid format', () => {
      const eventId = extractEspnEventId('espn_pga_abc');
      expect(eventId).toBeNull();
    });
  });
});
