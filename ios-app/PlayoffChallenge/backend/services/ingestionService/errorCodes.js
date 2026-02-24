/**
 * Ingestion Error Codes Registry
 *
 * Enumerated error codes for all ingestion validation and operation failures.
 * These are used to identify the root cause and inform recovery procedures.
 *
 * Pattern: CATEGORY_SPECIFIC_FAILURE
 * - All codes are uppercase with underscores
 * - Every error must be enumerated (no generic errors)
 * - Frontend and ops can handle specific codes
 */

const INGESTION_ERROR_CODES = {
  // Validation failures: data type
  INVALID_DATA_TYPE: 'INVALID_DATA_TYPE', // Float, string when int expected, NaN, Infinity
  NUMERIC_STRING_NOT_ALLOWED: 'NUMERIC_STRING_NOT_ALLOWED', // "123" when 123 expected

  // Validation failures: required fields
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD', // Field is null/undefined/missing

  // Validation failures: player/participant
  INVALID_PLAYER_ID: 'INVALID_PLAYER_ID', // Player not in contest participants
  UNKNOWN_PLAYER: 'UNKNOWN_PLAYER', // Player not in players table

  // Validation failures: range/bounds
  INVALID_ROUND_NUMBER: 'INVALID_ROUND_NUMBER', // Round > configured max
  OUT_OF_RANGE_SCORE: 'OUT_OF_RANGE_SCORE', // Score negative or > max allowed
  INVALID_STATUS: 'INVALID_STATUS', // Invalid player status (e.g., not 'cut')

  // Validation failures: schema/structure
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH', // Provider data structure doesn't match expected format
  MALFORMED_JSON: 'MALFORMED_JSON', // JSON parse error
  UNSUPPORTED_LEADERBOARD_SCHEMA: 'UNSUPPORTED_LEADERBOARD_SCHEMA',

  // Validation failures: duplication/consistency
  DUPLICATE_ROUND_FOR_PLAYER: 'DUPLICATE_ROUND_FOR_PLAYER', // Same player updated twice in one ingestion
  INCONSISTENT_LEADERBOARD_ORDER: 'INCONSISTENT_LEADERBOARD_ORDER', // Order doesn't match scores

  // Ingestion operation failures
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT', // Provider didn't respond in 5 seconds
  PROVIDER_ERROR: 'PROVIDER_ERROR', // HTTP 5xx response (retryable)
  NETWORK_ERROR: 'NETWORK_ERROR', // Network failure (retryable)
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND', // HTTP 404
  PROVIDER_FORBIDDEN: 'PROVIDER_FORBIDDEN', // HTTP 403
  PROVIDER_INVALID_REQUEST: 'PROVIDER_INVALID_REQUEST', // HTTP 400
  PROVIDER_UNAUTHORIZED: 'PROVIDER_UNAUTHORIZED', // HTTP 401

  // Settlement failures
  SETTLEMENT_INCOMPLETE_SCORES: 'SETTLEMENT_INCOMPLETE_SCORES', // Participant missing scores for rounds
  SETTLEMENT_VALIDATION_FAILED: 'SETTLEMENT_VALIDATION_FAILED', // Event failed validation during settlement
  SETTLEMENT_INCONSISTENT_STATE: 'SETTLEMENT_INCONSISTENT_STATE', // Data drift between ingestion and settlement

  // Contest state failures
  CONTEST_NOT_FOUND: 'CONTEST_NOT_FOUND',
  CONTEST_NOT_LOCKED: 'CONTEST_NOT_LOCKED', // Cannot ingest for non-LOCKED/LIVE contests
};

/**
 * Get human-readable message for an error code
 * @param {string} code - Error code from INGESTION_ERROR_CODES
 * @param {Object} context - Additional context (field, expected, actual, etc.)
 * @returns {string} Human-readable error message
 */
function getErrorMessage(code, context = {}) {
  const messages = {
    INVALID_DATA_TYPE: `Invalid data type: expected ${context.expected}, got ${context.actual}`,
    NUMERIC_STRING_NOT_ALLOWED: `Numeric string not allowed for field ${context.field}: got "${context.actual}", expected ${context.expected}`,
    MISSING_REQUIRED_FIELD: `Missing required field: ${context.field}`,
    INVALID_PLAYER_ID: `Player ID not in contest participants: ${context.player_id}`,
    UNKNOWN_PLAYER: `Player not found in system: ${context.player_id}`,
    INVALID_ROUND_NUMBER: `Round number out of range: ${context.round_number} (max: ${context.max})`,
    OUT_OF_RANGE_SCORE: `Score out of range: ${context.value} (valid: ${context.min}-${context.max})`,
    INVALID_STATUS: `Invalid status value: ${context.status}`,
    SCHEMA_MISMATCH: `Provider response schema mismatch: ${context.reason}`,
    MALFORMED_JSON: `Malformed JSON response: ${context.reason}`,
    UNSUPPORTED_LEADERBOARD_SCHEMA: `Unsupported leaderboard schema version: ${context.version}`,
    DUPLICATE_ROUND_FOR_PLAYER: `Player ${context.player_id} has duplicate updates in round ${context.round_number}`,
    INCONSISTENT_LEADERBOARD_ORDER: `Leaderboard order does not match scores`,
    PROVIDER_TIMEOUT: `Provider did not respond within 5 seconds`,
    PROVIDER_ERROR: `Provider returned HTTP ${context.status}: ${context.reason}`,
    NETWORK_ERROR: `Network error: ${context.reason}`,
    PROVIDER_NOT_FOUND: `Provider endpoint not found (HTTP 404)`,
    PROVIDER_FORBIDDEN: `Access forbidden (HTTP 403)`,
    PROVIDER_INVALID_REQUEST: `Invalid request to provider (HTTP 400): ${context.reason}`,
    PROVIDER_UNAUTHORIZED: `Unauthorized to access provider (HTTP 401)`,
    SETTLEMENT_INCOMPLETE_SCORES: `Settlement failed: ${context.count} participant(s) missing scores`,
    SETTLEMENT_VALIDATION_FAILED: `Event validation failed during settlement: ${context.reason}`,
    SETTLEMENT_INCONSISTENT_STATE: `Consistent state error: ${context.reason}`,
    CONTEST_NOT_FOUND: `Contest not found`,
    CONTEST_NOT_LOCKED: `Cannot ingest for contest not in LOCKED/LIVE state`,
  };

  return messages[code] || `Unknown error: ${code}`;
}

module.exports = {
  INGESTION_ERROR_CODES,
  getErrorMessage,
};
