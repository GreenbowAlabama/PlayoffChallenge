/**
 * Ingestion Validator
 *
 * Pure validation function for provider data.
 * - No database writes
 * - No side effects
 * - All errors collected before returning
 * - Strict type checking (no coercion)
 *
 * This validator ensures that ingestion data conforms to schema
 * before any persistence or settlement logic.
 */

const { INGESTION_ERROR_CODES } = require('./errorCodes');

/**
 * Validate ingestion data against schema and participant list
 *
 * @param {Object} data - Provider data to validate
 * @param {Object} schema - Validation schema with rules
 * @param {Array} participants - List of valid participant objects (id, name, etc.)
 * @returns {Object} { valid: boolean, errors: Array, data: Object }
 *   - valid: true if no validation errors
 *   - errors: array of { code, field, message, ... } objects
 *   - data: original data (unmodified)
 */
function validate(data, schema, participants) {
  const errors = [];

  if (!data) {
    return {
      valid: false,
      errors: [
        {
          code: INGESTION_ERROR_CODES.SCHEMA_MISMATCH,
          message: 'Data is null or undefined'
        }
      ],
      data: null
    };
  }

  // Build participant ID set for O(1) lookup
  const participantIds = new Set((participants || []).map(p => p.id));

  // 1. Check required fields first
  if (schema.required_fields && Array.isArray(schema.required_fields)) {
    for (const field of schema.required_fields) {
      const value = data[field];

      // Check if field is missing, null, or undefined
      if (value === null || value === undefined || !(field in data)) {
        errors.push({
          code: INGESTION_ERROR_CODES.MISSING_REQUIRED_FIELD,
          field,
          message: `Missing required field: ${field}`
        });
        continue; // Skip further validation for this field
      }

      // 2. Check field types (before range validation)
      if (schema.field_types && schema.field_types[field]) {
        const expectedType = schema.field_types[field];
        const validationError = validateFieldType(field, value, expectedType);

        if (validationError) {
          errors.push(validationError);
          continue; // Skip range validation if type is wrong
        }
      }

      // 3. Check field ranges (only for valid types)
      if (field === 'round_number' && schema.round_max !== undefined) {
        if (value > schema.round_max || value < 0) {
          errors.push({
            code: INGESTION_ERROR_CODES.INVALID_ROUND_NUMBER,
            field: 'round_number',
            round_number: value,
            max: schema.round_max,
            message: `Round number out of range: ${value} (max: ${schema.round_max})`
          });
        }
      }

      // Score range validation (e.g., strokes, score)
      if ((field === 'strokes' || field === 'score') && schema.strokes_range) {
        const { min, max } = schema.strokes_range;
        if (value < min || value > max) {
          errors.push({
            code: INGESTION_ERROR_CODES.OUT_OF_RANGE_SCORE,
            field,
            value,
            min,
            max,
            message: `Score out of range: ${value} (valid: ${min}-${max})`
          });
        }
      }
    }
  }

  // 4. Validate player_id references actual participant
  if (data.player_id) {
    if (!participantIds.has(data.player_id)) {
      errors.push({
        code: INGESTION_ERROR_CODES.INVALID_PLAYER_ID,
        field: 'player_id',
        player_id: data.player_id,
        message: `Player ID not in contest participants: ${data.player_id}`
      });
    }
  }

  // 5. Validate status if present and schema defines allowed values
  if (data.status && schema.allowed_statuses) {
    if (!schema.allowed_statuses.includes(data.status)) {
      errors.push({
        code: INGESTION_ERROR_CODES.INVALID_STATUS,
        field: 'status',
        status: data.status,
        message: `Invalid status value: ${data.status}`
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data // Return original data unmodified
  };
}

/**
 * Validate a single field's type
 *
 * @param {string} field - Field name
 * @param {*} value - Field value
 * @param {string} expectedType - Expected type (integer, string, etc.)
 * @returns {Object|null} Error object if invalid, null if valid
 */
function validateFieldType(field, value, expectedType) {
  if (expectedType === 'integer') {
    // Check for numeric string FIRST (most specific error)
    if (typeof value === 'string') {
      return {
        code: INGESTION_ERROR_CODES.NUMERIC_STRING_NOT_ALLOWED,
        field,
        expected: 'integer',
        actual: value,
        message: `Numeric string not allowed for field ${field}: got "${value}", expected integer`
      };
    }

    // Check for NaN, Infinity
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return {
        code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
        field,
        expected: 'integer',
        actual: value,
        message: `Invalid data type: expected integer, got ${value}`
      };
    }

    // Check for float (has decimal part)
    if (typeof value === 'number' && !Number.isInteger(value)) {
      return {
        code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
        field,
        expected: 'integer',
        actual: value,
        message: `Invalid data type: expected integer (no decimals), got float ${value}`
      };
    }

    // Must be actual integer type
    if (typeof value !== 'number') {
      return {
        code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
        field,
        expected: 'integer',
        actual: typeof value,
        message: `Invalid data type: expected integer, got ${typeof value}`
      };
    }
  }

  if (expectedType === 'string') {
    if (typeof value !== 'string') {
      return {
        code: INGESTION_ERROR_CODES.INVALID_DATA_TYPE,
        field,
        expected: 'string',
        actual: typeof value,
        message: `Invalid data type: expected string, got ${typeof value}`
      };
    }
  }

  return null; // Valid
}

/**
 * Canonicalize JSON for deterministic hashing
 *
 * Recursively sorts all object keys alphabetically.
 * Preserves array order.
 *
 * @param {*} obj - Object to canonicalize
 * @returns {*} Canonicalized object
 */
function canonicalizeJson(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Primitives: return as-is
  if (typeof obj !== 'object') {
    return obj;
  }

  // Arrays: recursively canonicalize, preserve order
  if (Array.isArray(obj)) {
    return obj.map(item => canonicalizeJson(item));
  }

  // Objects: sort keys, recursively canonicalize values
  const keys = Object.keys(obj).sort();
  const canonical = {};
  keys.forEach(key => {
    canonical[key] = canonicalizeJson(obj[key]);
  });

  return canonical;
}

module.exports = {
  validate,
  validateFieldType,
  canonicalizeJson
};
