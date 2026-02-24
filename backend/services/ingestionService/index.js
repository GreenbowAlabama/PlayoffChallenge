/**
 * Ingestion Service
 *
 * Core ingestion pipeline for provider data ingestion.
 * - Validates provider data against schema
 * - Persists ingestion events (append-only)
 * - Handles retries, timeouts, error logging
 * - Deduplicates payloads by hash
 *
 * Components:
 * - errorCodes: Enumerated error registry
 * - ingestionValidator: Pure validation logic (no side effects)
 * - (Coming) ingestionService: Orchestration with retries and DB persistence
 */

const { INGESTION_ERROR_CODES, getErrorMessage } = require('./errorCodes');
const {
  validate,
  validateFieldType,
  canonicalizeJson
} = require('./ingestionValidator');

module.exports = {
  // Error registry
  INGESTION_ERROR_CODES,
  getErrorMessage,

  // Validation
  validate,
  validateFieldType,
  canonicalizeJson
};
