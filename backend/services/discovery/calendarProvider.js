/**
 * Calendar Provider — ESPN PGA Events
 *
 * Batch 1: Reads ESPN calendar fixture.
 * Batch 2+: Will replace with real ESPN API polling.
 *
 * Single responsibility:
 * - Load calendar data from fixture
 * - Normalize ESPN schema to internal format
 * - Return raw events (filtering is upstream responsibility)
 *
 * Normalization:
 * - provider_event_id = `espn_pga_${id}`
 * - name = label
 * - start_time = new Date(startDate) [UTC]
 * - end_time = new Date(endDate) [UTC]
 */

/**
 * Get all PGA events from ESPN calendar fixture
 *
 * @returns {Array} Normalized events
 *   [
 *     {
 *       provider_event_id: string,
 *       name: string,
 *       start_time: Date,
 *       end_time: Date
 *     },
 *     ...
 *   ]
 * @throws {Error} If fixture cannot be loaded
 */
function getAllEvents() {
  let calendarFixture;

  try {
    // Batch 1: Read from fixture
    // Path is relative to this file (backend/services/discovery/)
    // so we go up two levels to backend, then to tests/fixtures
    calendarFixture = require('../../tests/fixtures/espn-pga-calendar-staging.json');
  } catch (err) {
    console.error(
      '[Discovery] CRITICAL: Failed to load espn-pga-calendar-staging.json: ' + err.message
    );
    throw new Error('Calendar fixture not found or malformed: ' + err.message);
  }

  if (!calendarFixture.events || !Array.isArray(calendarFixture.events)) {
    console.error('[Discovery] CRITICAL: Calendar fixture missing "events" array');
    throw new Error('Calendar fixture invalid: missing events array');
  }

  // Normalize ESPN schema to internal format
  const normalizedEvents = calendarFixture.events.map(espnEvent => ({
    provider_event_id: `espn_pga_${espnEvent.id}`,
    name: espnEvent.label,
    start_time: new Date(espnEvent.startDate),
    end_time: new Date(espnEvent.endDate)
  }));

  return normalizedEvents;
}

/**
 * Get next upcoming event within 7-day window
 *
 * @param {Date} now - Current time (for determinism)
 * @returns {Object|null} Event object or null if no event in window
 */
function getNextUpcomingEvent(now = new Date()) {
  const events = getAllEvents();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  console.log(
    `[Discovery Calendar] Checking window: ${now.toISOString()} to ${sevenDaysFromNow.toISOString()} (${events.length} total events)`
  );

  // Filter: start_time > now AND start_time <= now + 7 days
  const upcomingEvents = events.filter(
    event => event.start_time > now && event.start_time <= sevenDaysFromNow
  );

  if (upcomingEvents.length === 0) {
    console.log('[Discovery Calendar] No upcoming events in 7-day window');
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

module.exports = {
  getAllEvents,
  getNextUpcomingEvent
};
