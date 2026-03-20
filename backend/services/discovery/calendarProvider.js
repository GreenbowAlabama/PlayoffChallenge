/**
 * Calendar Provider — ESPN PGA Events
 *
 * Source priority (highest first):
 *   1. Live ESPN API (if USE_LIVE_PGA_CALENDAR !== 'false' and cache is warm)
 *   2. Staging fixture: espn-pga-calendar-staging.json (fallback, near-term events)
 *   3. Supplement fixture: espn-pga-calendar-2026.json (additional events)
 *
 * Architecture:
 * - Live fetch fires on module load (non-blocking async)
 * - getAllEvents() is synchronous — reads from cache or fixtures
 * - Discovery worker's 5-min interval ensures cache is warm before first cycle
 * - Tests set USE_LIVE_PGA_CALENDAR=false or NODE_ENV=test to skip live fetch
 *
 * Deduplication:
 * - Key: ESPN event ID
 * - First source wins (priority order above)
 *
 * Normalization (all sources):
 * - provider_event_id = `espn_pga_${id}`
 * - name = label
 * - start_time = new Date(startDate) [UTC]
 * - end_time = new Date(endDate) [UTC]
 */

const { fetchEspnCalendar } = require('./espnCalendarFetcher');

// ===== LIVE CALENDAR CACHE =====
let _liveCalendarCache = null;
let _liveFetchAttempted = false;

// Exposed promise for explicit cache-warming (used in tests)
let _liveFetchPromise = null;

/**
 * Determine if live fetch should be attempted.
 * Skipped when USE_LIVE_PGA_CALENDAR=false or NODE_ENV=test.
 */
function shouldUseLiveCalendar() {
  if (process.env.USE_LIVE_PGA_CALENDAR === 'false') return false;
  if (process.env.NODE_ENV === 'test') return false;
  return true;
}

/**
 * Warm the live calendar cache by fetching from ESPN API.
 * Non-blocking: failures are logged, cache stays null.
 *
 * @returns {Promise<void>}
 */
async function warmLiveCalendarCache() {
  if (_liveFetchAttempted) return;
  _liveFetchAttempted = true;

  try {
    const liveEvents = await fetchEspnCalendar();
    if (liveEvents && liveEvents.length > 0) {
      _liveCalendarCache = liveEvents;
      console.log(`[Discovery Calendar] source=LIVE_API events=${liveEvents.length}`);
    } else {
      console.warn('[Discovery Calendar] Live API returned no events, using FIXTURE_FALLBACK');
    }
  } catch (err) {
    console.warn(`[Discovery Calendar] Live API failed: ${err.message}, using FIXTURE_FALLBACK`);
  }
}

// Fire live fetch on module load (non-blocking)
if (shouldUseLiveCalendar()) {
  _liveFetchPromise = warmLiveCalendarCache();
}

// ===== FIXTURE EXTRACTION =====

/**
 * Extract raw event entries from a fixture, supporting both shapes:
 *   - Staging shape: response.data.leagues[0].calendar (array of {id, label, startDate, endDate})
 *   - 2026 shape: response.events (array of {id, label, startDate, endDate})
 *
 * @param {Object} fixture - Parsed JSON fixture
 * @param {string} sourceName - Fixture name for logging
 * @returns {Array} Raw event entries [{id, label, startDate, endDate}]
 */
function extractRawEvents(fixture, sourceName) {
  // Shape 1: staging (data.leagues[0].calendar)
  const calendar = fixture?.data?.leagues?.[0]?.calendar;
  if (Array.isArray(calendar) && calendar.length > 0) {
    return calendar;
  }

  // Shape 2: 2026 (events[])
  const events = fixture?.events;
  if (Array.isArray(events) && events.length > 0) {
    return events;
  }

  console.warn(`[Discovery] Calendar fixture "${sourceName}" has no extractable events`);
  return [];
}

/**
 * Normalize a raw event entry to discovery contract format.
 *
 * @param {Object} tournament - Raw event {id, label, startDate, endDate}
 * @returns {Object} Normalized event {provider_event_id, name, start_time, end_time}
 */
function normalizeEvent(tournament) {
  return {
    provider_event_id: `espn_pga_${tournament.id}`,
    name: tournament.label,
    start_time: new Date(tournament.startDate),
    end_time: new Date(tournament.endDate)
  };
}

// ===== PUBLIC API =====

/**
 * Get all PGA events from available sources.
 *
 * Synchronous. Merges events from live cache (if warm) + fixture files.
 * Deduplicates by ESPN ID; first source wins (priority order).
 *
 * Logs which source was used and total event count.
 *
 * @returns {Array} Normalized events
 *   [{provider_event_id, name, start_time, end_time}]
 * @throws {Error} If all sources fail to produce events
 */
function getAllEvents() {
  const sources = [];
  let primarySource = 'FIXTURE_FALLBACK';

  // Source 1: Live API cache (highest priority)
  if (_liveCalendarCache && _liveCalendarCache.length > 0) {
    sources.push({ name: 'LIVE_API', events: _liveCalendarCache });
    primarySource = 'LIVE_API';
  }

  // Source 2: Staging fixture (fallback / primary when live unavailable)
  let stagingFixture;
  try {
    stagingFixture = require('../../tests/fixtures/espn-pga-calendar-staging.json');
  } catch (err) {
    // If live cache is available, staging failure is non-fatal
    if (primarySource !== 'LIVE_API') {
      console.error(
        '[Discovery] CRITICAL: Failed to load espn-pga-calendar-staging.json: ' + err.message
      );
      throw new Error('Calendar fixture not found or malformed: ' + err.message);
    }
    console.warn('[Discovery] Staging fixture unavailable, using live cache only');
  }

  if (stagingFixture) {
    const stagingRaw = extractRawEvents(stagingFixture, 'espn-pga-calendar-staging.json');
    if (stagingRaw.length > 0) {
      sources.push({ name: 'staging_fixture', events: stagingRaw });
      if (primarySource === 'FIXTURE_FALLBACK') primarySource = 'FIXTURE_FALLBACK';
    }
  }

  // Source 3: Supplement 2026 fixture
  try {
    const supplementFixture = require('../../tests/fixtures/espn-pga-calendar-2026.json');
    const supplementRaw = extractRawEvents(supplementFixture, 'espn-pga-calendar-2026.json');
    if (supplementRaw.length > 0) {
      sources.push({ name: 'supplement_fixture', events: supplementRaw });
    }
  } catch (err) {
    // Non-blocking: supplement fixture is optional
    console.warn('[Discovery] Could not load espn-pga-calendar-2026.json: ' + err.message);
  }

  // Merge all sources with deduplication (first source wins by priority)
  const seenIds = new Set();
  const mergedRaw = [];

  for (const source of sources) {
    for (const event of source.events) {
      const eventId = String(event.id);
      if (!seenIds.has(eventId)) {
        seenIds.add(eventId);
        mergedRaw.push(event);
      }
    }
  }

  if (mergedRaw.length === 0) {
    console.error('[Discovery] CRITICAL: All sources produced 0 events');
    throw new Error('Calendar provider: no events from any source');
  }

  // Normalize to discovery contract format
  const normalizedEvents = mergedRaw.map(normalizeEvent);

  console.log(
    `[Discovery Calendar] source=${primarySource} events=${normalizedEvents.length}`
  );

  return normalizedEvents;
}

/**
 * Get next upcoming event within 14-day window
 *
 * @param {Date} now - Current time (for determinism)
 * @returns {Object|null} Event object or null if no event in window
 */
function getNextUpcomingEvent(now = new Date()) {
  const events = getAllEvents();
  // TEMPORARY: Expanded to 14 days for testing My Lineup flow. Revert to 7 days after feature validation.
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  console.log(
    `[Discovery Calendar] Checking window: ${now.toISOString()} to ${fourteenDaysFromNow.toISOString()} (${events.length} total events)`
  );

  // Filter: start_time > now AND start_time <= now + 14 days
  const upcomingEvents = events.filter(
    event => event.start_time > now && event.start_time <= fourteenDaysFromNow
  );

  if (upcomingEvents.length === 0) {
    console.log('[Discovery Calendar] No upcoming events in 14-day window');
    return null;
  }

  // Sort by start_time ascending, take first
  upcomingEvents.sort((a, b) => a.start_time - b.start_time);
  const nextEvent = upcomingEvents[0];
  console.log(
    `[Discovery Calendar] Found ${upcomingEvents.length} upcoming events. Next: ${nextEvent.provider_event_id} (${nextEvent.name})`
  );
  return nextEvent;
}

/**
 * Wait for the live calendar cache to be populated.
 * Used in tests to await the module-level fetch.
 *
 * @returns {Promise<void>}
 */
async function ensureLiveCalendar() {
  if (_liveFetchPromise) {
    await _liveFetchPromise;
  }
}

/**
 * Reset internal cache state. Used by tests only.
 */
function _resetForTesting() {
  _liveCalendarCache = null;
  _liveFetchAttempted = false;
  _liveFetchPromise = null;
}

/**
 * Inject live cache directly. Used by tests only.
 * @param {Array|null} events - Raw events to cache, or null to clear
 */
function _setLiveCacheForTesting(events) {
  _liveCalendarCache = events;
  _liveFetchAttempted = true;
}

module.exports = {
  getAllEvents,
  getNextUpcomingEvent,
  ensureLiveCalendar,
  _resetForTesting,
  _setLiveCacheForTesting
};
