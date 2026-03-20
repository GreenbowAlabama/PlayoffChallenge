/**
 * Calendar Provider Tests
 *
 * Verifies that calendarProvider:
 * - Loads and merges events from both fixture shapes (staging + 2026)
 * - Deduplicates events by ESPN ID
 * - Returns all events in normalized discovery contract format
 * - Includes Houston Open and events between Valspar and Masters
 * - Does not regress existing Valspar / Masters / Arnold Palmer parsing
 * - Uses live API cache when available (with mock)
 * - Falls back to fixtures when live API unavailable
 */

// Force fixture-only mode for all tests unless overridden
const originalEnv = process.env.USE_LIVE_PGA_CALENDAR;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  // Clear cached modules so getAllEvents() re-reads fixtures and re-evaluates env
  jest.resetModules();
  // Default: fixture-only mode (NODE_ENV=test already set by Jest, but be explicit)
  process.env.USE_LIVE_PGA_CALENDAR = 'false';
});

afterEach(() => {
  // Restore original env
  if (originalEnv !== undefined) {
    process.env.USE_LIVE_PGA_CALENDAR = originalEnv;
  } else {
    delete process.env.USE_LIVE_PGA_CALENDAR;
  }
});

describe('calendarProvider — fixture mode (USE_LIVE_PGA_CALENDAR=false)', () => {
  describe('getAllEvents', () => {
    test('returns normalized events with required discovery contract fields', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);

      // Every event must have the exact discovery contract shape
      for (const event of events) {
        expect(event).toHaveProperty('provider_event_id');
        expect(event).toHaveProperty('name');
        expect(event).toHaveProperty('start_time');
        expect(event).toHaveProperty('end_time');

        // provider_event_id must follow espn_pga_{id} format
        expect(event.provider_event_id).toMatch(/^espn_pga_\d+$/);

        // Dates must be valid Date objects
        expect(event.start_time).toBeInstanceOf(Date);
        expect(event.end_time).toBeInstanceOf(Date);
        expect(isNaN(event.start_time.getTime())).toBe(false);
        expect(isNaN(event.end_time.getTime())).toBe(false);

        // name must be non-empty string
        expect(typeof event.name).toBe('string');
        expect(event.name.length).toBeGreaterThan(0);
      }
    });

    test('includes Valspar Championship (existing staging event)', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const valspar = events.find(e => e.provider_event_id === 'espn_pga_401811938');
      expect(valspar).toBeDefined();
      expect(valspar.name).toBe('Valspar Championship');
      expect(valspar.start_time.toISOString()).toBe('2026-03-19T07:00:00.000Z');
    });

    test('includes Masters Tournament (present in both fixtures, deduplicated)', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const masters = events.filter(e => e.provider_event_id === 'espn_pga_401811941');
      // Must appear exactly once (deduplication)
      expect(masters).toHaveLength(1);
      expect(masters[0].name).toBe('Masters Tournament');
    });

    test('includes Houston Open (event between Valspar and Masters)', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const houston = events.find(e => e.provider_event_id === 'espn_pga_401811939');
      expect(houston).toBeDefined();
      expect(houston.name).toContain('Houston');
      // Houston should be after Valspar (Mar 22) and before Masters (Apr 9)
      expect(houston.start_time.getTime()).toBeGreaterThan(new Date('2026-03-22T00:00Z').getTime());
      expect(houston.start_time.getTime()).toBeLessThan(new Date('2026-04-09T00:00Z').getTime());
    });

    test('includes Valero Texas Open (event between Houston and Masters)', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const valero = events.find(e => e.provider_event_id === 'espn_pga_401811940');
      expect(valero).toBeDefined();
      expect(valero.name).toContain('Valero');
    });

    test('includes events from 2026 fixture not in staging (PGA Championship)', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const pgaChamp = events.find(e => e.provider_event_id === 'espn_pga_401823456');
      expect(pgaChamp).toBeDefined();
      expect(pgaChamp.name).toBe('PGA Championship');
    });

    test('no duplicate provider_event_id values', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      const ids = events.map(e => e.provider_event_id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    test('events are not empty after merge', () => {
      const { getAllEvents } = require('../../services/discovery/calendarProvider');
      const events = getAllEvents();

      // Staging has 8 events, 2026 has 3 events, 1 overlap (Masters)
      // Total unique: 10
      expect(events.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getNextUpcomingEvent', () => {
    test('returns Houston Open when now is after Valspar start and before Houston start', () => {
      const { getNextUpcomingEvent } = require('../../services/discovery/calendarProvider');

      // March 23: after Valspar started (Mar 19), before Houston (Mar 26)
      const now = new Date('2026-03-23T12:00:00Z');
      const next = getNextUpcomingEvent(now);

      expect(next).not.toBeNull();
      expect(next.provider_event_id).toBe('espn_pga_401811939');
      expect(next.name).toContain('Houston');
    });

    test('returns PLAYERS Championship when now is Mar 10 (earliest in 14-day window)', () => {
      const { getNextUpcomingEvent } = require('../../services/discovery/calendarProvider');

      const now = new Date('2026-03-10T12:00:00Z');
      const next = getNextUpcomingEvent(now);

      expect(next).not.toBeNull();
      expect(next.provider_event_id).toBe('espn_pga_401811937');
    });
  });
});

describe('calendarProvider — live API mode (mocked)', () => {
  test('live cache takes priority over fixture data', () => {
    // Mock the fetcher BEFORE requiring calendarProvider
    jest.doMock('../../services/discovery/espnCalendarFetcher', () => ({
      fetchEspnCalendar: jest.fn().mockResolvedValue(null)
    }));

    const { getAllEvents, _setLiveCacheForTesting } = require('../../services/discovery/calendarProvider');

    // Inject a live cache with a synthetic event not in any fixture
    _setLiveCacheForTesting([
      {
        id: '999999999',
        label: 'Live API Synthetic Event',
        startDate: '2026-07-10T07:00Z',
        endDate: '2026-07-13T07:00Z'
      }
    ]);

    const events = getAllEvents();

    // Synthetic event from live cache should be present
    const synthetic = events.find(e => e.provider_event_id === 'espn_pga_999999999');
    expect(synthetic).toBeDefined();
    expect(synthetic.name).toBe('Live API Synthetic Event');

    // Fixture events should also be present (merged)
    const valspar = events.find(e => e.provider_event_id === 'espn_pga_401811938');
    expect(valspar).toBeDefined();
  });

  test('live cache wins deduplication over fixtures', () => {
    jest.doMock('../../services/discovery/espnCalendarFetcher', () => ({
      fetchEspnCalendar: jest.fn().mockResolvedValue(null)
    }));

    const { getAllEvents, _setLiveCacheForTesting } = require('../../services/discovery/calendarProvider');

    // Inject live cache with Masters using a DIFFERENT name (to prove live wins)
    _setLiveCacheForTesting([
      {
        id: '401811941',
        label: 'Masters Tournament (Live)',
        startDate: '2026-04-09T07:00Z',
        endDate: '2026-04-12T07:00Z'
      }
    ]);

    const events = getAllEvents();

    const masters = events.filter(e => e.provider_event_id === 'espn_pga_401811941');
    // Exactly one Masters (deduplicated)
    expect(masters).toHaveLength(1);
    // Live cache name wins over fixture name
    expect(masters[0].name).toBe('Masters Tournament (Live)');
  });

  test('no duplicate IDs when live cache overlaps fixtures', () => {
    jest.doMock('../../services/discovery/espnCalendarFetcher', () => ({
      fetchEspnCalendar: jest.fn().mockResolvedValue(null)
    }));

    const { getAllEvents, _setLiveCacheForTesting } = require('../../services/discovery/calendarProvider');

    // Inject live cache with several events that overlap fixtures
    _setLiveCacheForTesting([
      { id: '401811938', label: 'Valspar (Live)', startDate: '2026-03-19T07:00Z', endDate: '2026-03-22T07:00Z' },
      { id: '401811939', label: 'Houston (Live)', startDate: '2026-03-26T07:00Z', endDate: '2026-03-29T07:00Z' },
      { id: '401811941', label: 'Masters (Live)', startDate: '2026-04-09T07:00Z', endDate: '2026-04-12T07:00Z' },
      { id: '888888888', label: 'New Live Event', startDate: '2026-08-01T07:00Z', endDate: '2026-08-04T07:00Z' }
    ]);

    const events = getAllEvents();
    const ids = events.map(e => e.provider_event_id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  test('falls back to fixtures when live cache is empty', () => {
    jest.doMock('../../services/discovery/espnCalendarFetcher', () => ({
      fetchEspnCalendar: jest.fn().mockResolvedValue(null)
    }));

    const { getAllEvents, _resetForTesting } = require('../../services/discovery/calendarProvider');
    _resetForTesting(); // Clear any cache

    const events = getAllEvents();

    // Should still return fixture events
    expect(events.length).toBeGreaterThanOrEqual(10);

    const houston = events.find(e => e.provider_event_id === 'espn_pga_401811939');
    expect(houston).toBeDefined();
  });
});
