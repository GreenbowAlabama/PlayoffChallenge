/**
 * ESPN Data Fetcher
 *
 * Fetches ESPN scoreboard/summary data for PGA events.
 * Used during contest discovery to derive accurate lock times.
 *
 * Single responsibility:
 * - Fetch ESPN API data for a specific event
 * - Return raw response or null on failure
 * - Non-blocking: failures do not stop discovery
 */

'use strict';

/**
 * Fetch ESPN scoreboard for PGA event.
 *
 * Uses ESPN public API endpoint:
 * https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard
 *
 * The scoreboard endpoint scopes events to the current tournament window.
 * Filters events by requested espnEventId to return the correct event.
 * Returns the event wrapped in an events array for compatibility with lock time extractor.
 *
 * @param {string} espnEventId - ESPN event ID to filter by (required)
 * @returns {Promise<Object|null>} Event wrapped as { events: [event] } or null if not found or fetch fails
 */
async function fetchEspnSummary(espnEventId) {
  const url = 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

  try {
    console.log('[ESPN Fetcher] Fetching PGA scoreboard');

    const response = await fetch(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'PlayoffChallenge/1.0'
      }
    });

    if (!response.ok) {
      console.warn(
        `[ESPN Fetcher] HTTP ${response.status} for scoreboard: ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    // Validate events array exists
    if (!Array.isArray(data.events) || data.events.length === 0) {
      console.warn('[ESPN Fetcher] Scoreboard response missing or empty events array');
      return null;
    }

    // Find and return the event matching the requested ID
    const requestedEvent = data.events.find(e => e.id === espnEventId);
    if (!requestedEvent) {
      throw new Error(`Event ${espnEventId} not found in scoreboard`);
    }

    console.log('[ESPN Fetcher] Selected event from scoreboard:', requestedEvent.id, requestedEvent.name);

    // Return event wrapped in events array for compatibility with lock time extractor
    return {
      events: [requestedEvent]
    };
  } catch (err) {
    // Non-blocking: log and return null
    console.warn(
      `[ESPN Fetcher] Failed to fetch scoreboard: ${err.message}`
    );
    return null;
  }
}

/**
 * Extract ESPN event ID from provider_event_id.
 *
 * Provider event IDs are formatted as: espn_pga_{eventId}
 * Example: espn_pga_401811941 → 401811941
 *
 * @param {string} providerEventId - Full provider event ID
 * @returns {string|null} ESPN event ID or null if format is invalid
 */
function extractEspnEventId(providerEventId) {
  if (!providerEventId || typeof providerEventId !== 'string') {
    return null;
  }

  const match = providerEventId.match(/^espn_pga_(\d+)$/);
  return match ? match[1] : null;
}

module.exports = {
  fetchEspnSummary,
  extractEspnEventId
};
