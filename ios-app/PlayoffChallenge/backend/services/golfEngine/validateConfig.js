/**
 * Tournament Config Validation
 *
 * Validates tournament configuration structure and required fields.
 * Pure function that collects all errors and reports them together.
 *
 * @param {Object} config - Tournament configuration object
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
function validateConfig(config) {
  const errors = [];

  if (!config) {
    errors.push('Config object is required');
    return { valid: false, errors };
  }

  // Required string fields
  const requiredStringFields = [
    'provider_event_id',
    'ingestion_endpoint',
    'field_source'
  ];

  for (const field of requiredStringFields) {
    if (!config[field] || typeof config[field] !== 'string') {
      errors.push(`${field} is required and must be a string`);
    }
  }

  // Required date fields
  const requiredDateFields = [
    'event_start_date',
    'event_end_date'
  ];

  for (const field of requiredDateFields) {
    if (!config[field]) {
      errors.push(`${field} is required`);
    } else if (!(config[field] instanceof Date) && typeof config[field] !== 'string') {
      errors.push(`${field} must be a valid date`);
    }
  }

  // round_count validation
  if (!config.round_count || typeof config.round_count !== 'number' || config.round_count <= 0) {
    errors.push('round_count is required and must be a positive integer');
  }

  // cut_after_round validation (optional but constrained)
  if (config.cut_after_round !== undefined && config.cut_after_round !== null) {
    if (typeof config.cut_after_round !== 'number') {
      errors.push('cut_after_round must be a number');
    } else if (config.cut_after_round < 1 || config.cut_after_round > (config.round_count || 0)) {
      errors.push('cut_after_round must be between 1 and round_count');
    }
  }

  // leaderboard_schema_version validation
  if (config.leaderboard_schema_version === undefined || config.leaderboard_schema_version === null) {
    errors.push('leaderboard_schema_version is required');
  } else if (typeof config.leaderboard_schema_version !== 'number') {
    errors.push('leaderboard_schema_version must be a number');
  } else if (config.leaderboard_schema_version !== 1) {
    errors.push(`Unsupported leaderboard_schema_version: ${config.leaderboard_schema_version}. Currently only version 1 is supported`);
  }

  // field_source validation
  if (config.field_source) {
    const validFieldSources = ['provider_sync', 'static_import'];
    if (!validFieldSources.includes(config.field_source)) {
      errors.push(`field_source must be one of: ${validFieldSources.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateConfig
};
