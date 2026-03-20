/**
 * ESPN Calendar Fetcher Tests
 *
 * Unit tests for live ESPN PGA calendar fetching.
 * All network calls are mocked — no real HTTP requests.
 */

'use strict';

// Mock global fetch before requiring the module
const mockFetch = jest.fn();
global.fetch = mockFetch;

const { fetchEspnCalendar, ESPN_SCOREBOARD_URL, FETCH_TIMEOUT_MS } = require('../../services/discovery/espnCalendarFetcher');

describe('espnCalendarFetcher', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchEspnCalendar', () => {
    test('returns normalized calendar entries from leagues[0].calendar shape', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          leagues: [{
            calendar: [
              { id: '401811939', label: 'Houston Open', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' },
              { id: '401811940', label: 'Valero Texas Open', startDate: '2026-04-02T07:00Z', endDate: '2026-04-05T07:00Z' }
            ]
          }]
        })
      });

      const result = await fetchEspnCalendar();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '401811939',
        label: 'Houston Open',
        startDate: '2026-03-26T07:00Z',
        endDate: '2026-03-29T07:00Z'
      });
    });

    test('returns normalized calendar entries from data.leagues[0].calendar shape', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            leagues: [{
              calendar: [
                { id: '401811939', label: 'Houston Open', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' }
              ]
            }]
          }
        })
      });

      const result = await fetchEspnCalendar();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('401811939');
    });

    test('normalizes "name" field to "label" when label is absent', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          leagues: [{
            calendar: [
              { id: '401811939', name: 'Houston Open', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' }
            ]
          }]
        })
      });

      const result = await fetchEspnCalendar();

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Houston Open');
    });

    test('filters out entries missing required fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          leagues: [{
            calendar: [
              { id: '401811939', label: 'Houston Open', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' },
              { id: '401811940' }, // missing label, startDate, endDate
              { label: 'No ID Event', startDate: '2026-04-01T07:00Z', endDate: '2026-04-04T07:00Z' } // missing id
            ]
          }]
        })
      });

      const result = await fetchEspnCalendar();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('401811939');
    });

    test('returns null on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      });

      const result = await fetchEspnCalendar();
      expect(result).toBeNull();
    });

    test('returns null on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await fetchEspnCalendar();
      expect(result).toBeNull();
    });

    test('returns null when response has no calendar array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          events: [{ id: '1', name: 'Some Event' }] // events, not leagues.calendar
        })
      });

      const result = await fetchEspnCalendar();
      expect(result).toBeNull();
    });

    test('returns null when calendar is empty', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          leagues: [{ calendar: [] }]
        })
      });

      const result = await fetchEspnCalendar();
      expect(result).toBeNull();
    });

    test('returns null on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await fetchEspnCalendar();
      expect(result).toBeNull();
    });

    test('coerces numeric event ID to string', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          leagues: [{
            calendar: [
              { id: 401811939, label: 'Houston Open', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' }
            ]
          }]
        })
      });

      const result = await fetchEspnCalendar();

      expect(result[0].id).toBe('401811939');
      expect(typeof result[0].id).toBe('string');
    });

    test('calls correct ESPN URL with abort signal', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ leagues: [{ calendar: [
          { id: '1', label: 'Test', startDate: '2026-01-01T00:00Z', endDate: '2026-01-04T00:00Z' }
        ] }] })
      });

      await fetchEspnCalendar();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(ESPN_SCOREBOARD_URL);
      expect(options.signal).toBeDefined();
      expect(options.headers['User-Agent']).toBe('PlayoffChallenge/1.0');
    });
  });

  describe('constants', () => {
    test('timeout is 3 seconds', () => {
      expect(FETCH_TIMEOUT_MS).toBe(3000);
    });

    test('URL targets ESPN PGA scoreboard', () => {
      expect(ESPN_SCOREBOARD_URL).toContain('golf/pga/scoreboard');
    });
  });
});
