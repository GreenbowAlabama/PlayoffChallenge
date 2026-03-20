/**
 * ESPN Calendar Fetcher
 *
 * Fetches the full PGA Tour season schedule from the ESPN public API.
 * Returns raw calendar entries in the same shape as fixture data:
 *   [{ id, label, startDate, endDate }]
 *
 * Single responsibility:
 * - Fetch PGA schedule from ESPN scoreboard endpoint (includes leagues[0].calendar)
 * - Normalize entry shape (handle label vs name field variants)
 * - Validate entries have required fields
 * - Return raw entries or null on failure
 *
 * Non-blocking: failures return null, never throw into caller.
 * Timeout: 3 seconds max to avoid blocking discovery cycles.
 */

'use strict';

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
const FETCH_TIMEOUT_MS = 3000;

/**
 * Fetch full PGA season calendar from ESPN API.
 *
 * Extracts the calendar array from the scoreboard endpoint's leagues data.
 * The scoreboard response includes leagues[0].calendar with all season events,
 * not just the currently active tournament.
 *
 * Handles two known response shapes:
 *   - response.leagues[0].calendar (standard)
 *   - response.data.leagues[0].calendar (web API variant)
 *
 * @returns {Promise<Array|null>} Raw calendar entries [{id, label, startDate, endDate}] or null on failure
 */
async function fetchEspnCalendar() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(ESPN_SCOREBOARD_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PlayoffChallenge/1.0'
      }
    });

    if (!response.ok) {
      console.warn(`[ESPN Calendar] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Extract calendar from known response shapes
    const calendar =
      data?.leagues?.[0]?.calendar ||
      data?.data?.leagues?.[0]?.calendar ||
      null;

    if (!Array.isArray(calendar) || calendar.length === 0) {
      console.warn('[ESPN Calendar] No calendar array in API response');
      return null;
    }

    // Validate and normalize entries
    // ESPN calendar entries use "label" for event name, but some variants use "name"
    const validEntries = calendar
      .filter(entry => {
        const hasId = entry.id != null;
        const hasName = typeof entry.label === 'string' || typeof entry.name === 'string';
        const hasStart = typeof entry.startDate === 'string';
        const hasEnd = typeof entry.endDate === 'string';
        return hasId && hasName && hasStart && hasEnd;
      })
      .map(entry => ({
        id: String(entry.id),
        label: entry.label || entry.name,
        startDate: entry.startDate,
        endDate: entry.endDate
      }));

    if (validEntries.length === 0) {
      console.warn('[ESPN Calendar] Calendar entries present but none passed validation');
      return null;
    }

    return validEntries;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[ESPN Calendar] Request timed out after ${FETCH_TIMEOUT_MS}ms`);
    } else {
      console.warn(`[ESPN Calendar] Fetch failed: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchEspnCalendar,
  ESPN_SCOREBOARD_URL,
  FETCH_TIMEOUT_MS
};
