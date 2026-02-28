/**
 * Discovery Validator
 *
 * Validates tournament discovery input before template creation.
 * - Deterministic: injected `now` for replay safety
 * - Strict: explicit allowed statuses, no implicit JS behavior
 * - Input-normalizing: ISO strings → Date normalization
 * - Zero side effects: no database access, pure validation
 *
 * This is the gatekeeper to automated revenue generation.
 * Every constraint is explicit and testable.
 */

// Explicit allowed statuses for provider tournaments
const ALLOWED_PROVIDER_STATUSES = Object.freeze(['SCHEDULED', 'CANCELLED']);

// Discovery window: tournaments must be within ±90 days of discovery time
const DISCOVERY_WINDOW_DAYS = 90;
const DISCOVERY_WINDOW_MS = DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Normalize ISO string or Date to Date object
 * Deterministic: no timezone surprises
 *
 * @param {string|Date|null|undefined} value - ISO string or Date
 * @returns {{date: Date|null, error: string|null}}
 */
function normalizeToDate(value) {
  if (value === null || value === undefined) {
    return { date: null, error: null };
  }

  // If already a Date, validate it's valid
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return { date: null, error: 'Date is invalid (NaN)' };
    }
    return { date: value, error: null };
  }

  // If string, parse as ISO 8601
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      return { date: null, error: `Cannot parse as ISO 8601 date: "${value}"` };
    }
    return { date: parsed, error: null };
  }

  return { date: null, error: `Expected string or Date, got ${typeof value}` };
}

/**
 * Validate discovery input with injected `now` for determinism
 *
 * @param {Object} input - Discovery input
 * @param {string} input.provider_tournament_id - External provider tournament ID
 * @param {number} input.season_year - Season year (e.g., 2025)
 * @param {string} input.name - Tournament name
 * @param {string|Date} input.start_time - Tournament start time (ISO string or Date)
 * @param {string|Date} input.end_time - Tournament end time (ISO string or Date)
 * @param {string} input.status - Provider tournament status (REQUIRED)
 * @param {Date} now - Current time (injected for determinism)
 *
 * @returns {Object} {
 *   valid: boolean,
 *   error: string|null,
 *   errorCode: string|null,
 *   normalizedInput: Object|null (if valid)
 * }
 */
function validateDiscoveryInput(input, now) {
  // ===== PARAMETER VALIDATION =====
  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      error: 'Input must be a non-null object',
      errorCode: 'INVALID_INPUT',
      normalizedInput: null
    };
  }

  if (!(now instanceof Date) || isNaN(now.getTime())) {
    return {
      valid: false,
      error: 'now must be a valid Date object',
      errorCode: 'INVALID_NOW_PARAMETER',
      normalizedInput: null
    };
  }

  // ===== PROVIDER TOURNAMENT ID =====
  if (typeof input.provider_tournament_id !== 'string' || input.provider_tournament_id.trim() === '') {
    return {
      valid: false,
      error: 'provider_tournament_id must be a non-empty string',
      errorCode: 'MISSING_PROVIDER_TOURNAMENT_ID',
      normalizedInput: null
    };
  }
  const provider_tournament_id = input.provider_tournament_id.trim();

  // ===== SEASON YEAR =====
  const season_year = input.season_year;
  if (!Number.isInteger(season_year)) {
    return {
      valid: false,
      error: 'season_year must be an integer',
      errorCode: 'INVALID_SEASON_YEAR',
      normalizedInput: null
    };
  }
  if (season_year < 2000 || season_year > 2099) {
    return {
      valid: false,
      error: 'season_year must be between 2000 and 2099',
      errorCode: 'INVALID_SEASON_YEAR',
      normalizedInput: null
    };
  }

  // ===== TOURNAMENT NAME =====
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    return {
      valid: false,
      error: 'name must be a non-empty string',
      errorCode: 'MISSING_TOURNAMENT_NAME',
      normalizedInput: null
    };
  }
  const name = input.name.trim();

  // ===== START TIME =====
  if (input.start_time === null || input.start_time === undefined) {
    return {
      valid: false,
      error: 'start_time is required',
      errorCode: 'MISSING_START_TIME',
      normalizedInput: null
    };
  }

  const startNorm = normalizeToDate(input.start_time);
  if (startNorm.error) {
    return {
      valid: false,
      error: `start_time: ${startNorm.error}`,
      errorCode: 'INVALID_START_TIME',
      normalizedInput: null
    };
  }
  const start_time = startNorm.date;

  // ===== END TIME =====
  if (input.end_time === null || input.end_time === undefined) {
    return {
      valid: false,
      error: 'end_time is required',
      errorCode: 'MISSING_END_TIME',
      normalizedInput: null
    };
  }

  const endNorm = normalizeToDate(input.end_time);
  if (endNorm.error) {
    return {
      valid: false,
      error: `end_time: ${endNorm.error}`,
      errorCode: 'INVALID_END_TIME',
      normalizedInput: null
    };
  }
  const end_time = endNorm.date;

  // ===== TIME RANGE VALIDATION =====
  if (end_time.getTime() <= start_time.getTime()) {
    return {
      valid: false,
      error: 'end_time must be strictly after start_time',
      errorCode: 'INVALID_TIME_RANGE',
      normalizedInput: null
    };
  }

  // ===== STATUS VALIDATION (REQUIRED) =====
  if (typeof input.status !== 'string') {
    return {
      valid: false,
      error: 'status is required and must be a string',
      errorCode: 'MISSING_STATUS',
      normalizedInput: null
    };
  }

  const status = input.status.toUpperCase();
  if (!ALLOWED_PROVIDER_STATUSES.includes(status)) {
    return {
      valid: false,
      error: `status must be one of: ${ALLOWED_PROVIDER_STATUSES.join(', ')}. Got: "${input.status}"`,
      errorCode: 'INVALID_TOURNAMENT_STATUS',
      normalizedInput: null
    };
  }

  // ===== DISCOVERY WINDOW VALIDATION =====
  // Tournament must be within ±90 days of discovery time
  const now_ms = now.getTime();
  const start_ms = start_time.getTime();
  const end_ms = end_time.getTime();

  const windowStart_ms = now_ms - DISCOVERY_WINDOW_MS;
  const windowEnd_ms = now_ms + DISCOVERY_WINDOW_MS;

  if (start_ms < windowStart_ms || start_ms > windowEnd_ms) {
    return {
      valid: false,
      error: `start_time must be within ${DISCOVERY_WINDOW_DAYS} days of discovery time`,
      errorCode: 'OUTSIDE_DISCOVERY_WINDOW',
      normalizedInput: null
    };
  }

  // ===== ALL VALIDATIONS PASSED =====
  return {
    valid: true,
    error: null,
    errorCode: null,
    normalizedInput: {
      provider_tournament_id,
      season_year,
      name,
      start_time, // Normalized Date
      end_time,   // Normalized Date
      status      // Normalized to uppercase
    }
  };
}

/**
 * Map error code to HTTP status and user-friendly message
 *
 * @param {string} errorCode - Error code from validation
 * @returns {Object} { statusCode: number, message: string }
 */
function getErrorDetails(errorCode) {
  const errorMap = {
    'INVALID_INPUT': { statusCode: 400, message: 'Invalid input format' },
    'INVALID_NOW_PARAMETER': { statusCode: 500, message: 'Server error: invalid time parameter' },
    'MISSING_PROVIDER_TOURNAMENT_ID': { statusCode: 400, message: 'Missing provider tournament ID' },
    'INVALID_SEASON_YEAR': { statusCode: 400, message: 'Invalid season year' },
    'MISSING_TOURNAMENT_NAME': { statusCode: 400, message: 'Tournament name is required' },
    'MISSING_START_TIME': { statusCode: 400, message: 'Tournament start time is required' },
    'INVALID_START_TIME': { statusCode: 400, message: 'Invalid tournament start time format' },
    'MISSING_END_TIME': { statusCode: 400, message: 'Tournament end time is required' },
    'INVALID_END_TIME': { statusCode: 400, message: 'Invalid tournament end time format' },
    'INVALID_TIME_RANGE': { statusCode: 400, message: 'Tournament end time must be after start time' },
    'MISSING_STATUS': { statusCode: 400, message: 'Tournament status is required' },
    'INVALID_TOURNAMENT_STATUS': { statusCode: 400, message: 'Tournament status is not allowed for discovery' },
    'OUTSIDE_DISCOVERY_WINDOW': { statusCode: 400, message: 'Tournament is outside discovery window' }
  };

  return errorMap[errorCode] || { statusCode: 500, message: 'Unknown validation error' };
}

module.exports = {
  validateDiscoveryInput,
  normalizeToDate,
  getErrorDetails,
  ALLOWED_PROVIDER_STATUSES,
  DISCOVERY_WINDOW_DAYS,
  DISCOVERY_WINDOW_MS
};
