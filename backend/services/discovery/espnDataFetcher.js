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
 * The scoreboard endpoint already scopes events to the current tournament window.
 * Selects the first event returned (event IDs do not reliably match provider_event_id).
 * Returns the event wrapped in an events array for compatibility with lock time extractor.
 *
 * @param {string} espnEventId - ESPN event ID (unused, provided for compatibility)
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

    // Select the first event (espnEventId parameter is unused, provided for future compatibility)
    // The scoreboard endpoint already scopes to the current tournament window
    const event = data.events[0];

    console.log('[ESPN Fetcher] Selected first event from scoreboard:', event.id, event.name);

    // Return event wrapped in events array for compatibility with lock time extractor
    return {
      events: [event]
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
