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
 */
function getAllEvents() {
  // Batch 1: Read from fixture
  // Path is relative to this file (backend/services/discovery/)
  // so we go up two levels to backend, then to tests/fixtures
  const calendarFixture = require('../../tests/fixtures/espn-pga-calendar-2026.json');

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
 * Get next upcoming event within 60-day window
 *
 * @param {Date} now - Current time (for determinism)
 * @returns {Object|null} Event object or null if no event in window
 */
function getNextUpcomingEvent(now = new Date()) {
  const events = getAllEvents();

  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  // Filter: start_time > now AND start_time <= now + 60 days
  const upcomingEvents = events.filter(
    event => event.start_time > now && event.start_time <= sixtyDaysFromNow
  );

  if (upcomingEvents.length === 0) {
    return null;
  }

  // Sort by start_time ascending, take first
  upcomingEvents.sort((a, b) => a.start_time - b.start_time);
  return upcomingEvents[0];
}

module.exports = {
  getAllEvents,
  getNextUpcomingEvent
};
