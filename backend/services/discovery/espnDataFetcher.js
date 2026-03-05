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
 * Fetch ESPN scoreboard summary for a PGA event.
 *
 * Uses ESPN public API endpoint:
 * https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/summary?event={eventId}
 *
 * @param {string} espnEventId - ESPN event ID (numeric string, e.g., "401811941")
 * @returns {Promise<Object|null>} ESPN API response or null if fetch fails
 */
async function fetchEspnSummary(espnEventId) {
  if (!espnEventId || typeof espnEventId !== 'string') {
    console.warn('[ESPN Fetcher] Invalid espnEventId, skipping fetch');
    return null;
  }

  const url = `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/summary?event=${espnEventId}`;

  try {
    console.log(`[ESPN Fetcher] Fetching summary for event ${espnEventId}`);

    const response = await fetch(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'PlayoffChallenge/1.0'
      }
    });

    if (!response.ok) {
      console.warn(
        `[ESPN Fetcher] HTTP ${response.status} for event ${espnEventId}: ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();
    console.log(`[ESPN Fetcher] Successfully fetched summary for event ${espnEventId}`);
    return data;
  } catch (err) {
    // Non-blocking: log and return null
    console.warn(
      `[ESPN Fetcher] Failed to fetch event ${espnEventId}: ${err.message}`
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
