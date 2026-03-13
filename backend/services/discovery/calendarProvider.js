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
 * Reads the full season schedule from response.data.leagues[0].calendar
 * (the ESPN scoreboard API structure), not just active tournament events.
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
  let response;

  try {
    // Batch 1: Read from fixture
    // Path is relative to this file (backend/services/discovery/)
    // so we go up two levels to backend, then to tests/fixtures
    response = require('../../tests/fixtures/espn-pga-calendar-staging.json');
  } catch (err) {
    console.error(
      '[Discovery] CRITICAL: Failed to load espn-pga-calendar-staging.json: ' + err.message
    );
    throw new Error('Calendar fixture not found or malformed: ' + err.message);
  }

  // Extract calendar from the ESPN scoreboard API structure
  const calendar = response.data?.leagues?.[0]?.calendar || [];

  if (!Array.isArray(calendar) || calendar.length === 0) {
    console.error('[Discovery] CRITICAL: Calendar fixture missing "data.leagues[0].calendar" array');
    throw new Error('Calendar fixture invalid: missing data.leagues[0].calendar array');
  }

  // Normalize ESPN schema to internal format
  const normalizedEvents = calendar.map(tournament => ({
    provider_event_id: `espn_pga_${tournament.id}`,
    name: tournament.label,
    start_time: new Date(tournament.startDate),
    end_time: new Date(tournament.endDate)
  }));

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

module.exports = {
  getAllEvents,
  getNextUpcomingEvent
};
