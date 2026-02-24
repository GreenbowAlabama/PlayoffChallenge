/**
 * Schema Assertion Helpers for Contract Tests
 *
 * Provides Jest-compatible assertion functions that validate response bodies
 * against the OpenAPI schema. Eliminates field-by-field duplication in tests.
 *
 * Usage:
 *   const { assertMatchesContestDetailSchema, assertMatchesContestListSchema } = require('./assertMatchesSchema');
 *
 *   it('should match schema', () => {
 *     const response = await request(app).get('/api/custom-contests/123');
 *     assertMatchesContestDetailSchema(response.body);
 *   });
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { getValidator } = require('../../middleware/contractValidator');

/**
 * Assert that a response body matches the ContestDetailResponse schema
 * @param {object} body - Response body to validate
 * @throws {Error} If body does not match schema
 */
function assertMatchesContestDetailSchema(body) {
  const validate = getValidator('ContestDetailResponse');
  const valid = validate(body);

  if (!valid) {
    const errors = formatValidationErrors(validate.errors);
    throw new Error(`Response does not match ContestDetailResponse schema:\n${errors}`);
  }
}

/**
 * Assert that a response body matches the ContestListItem schema
 * @param {object} body - Single list item to validate
 * @throws {Error} If body does not match schema
 */
function assertMatchesContestListItemSchema(body) {
  const validate = getValidator('ContestListItem');
  const valid = validate(body);

  if (!valid) {
    const errors = formatValidationErrors(validate.errors);
    throw new Error(`Response does not match ContestListItem schema:\n${errors}`);
  }
}

/**
 * Assert that a response body is an array of ContestListItem objects
 * @param {array} body - Array of list items to validate
 * @throws {Error} If any item does not match schema
 */
function assertMatchesContestListSchema(body) {
  if (!Array.isArray(body)) {
    throw new Error(`Expected array, got ${typeof body}`);
  }

  body.forEach((item, index) => {
    const validate = getValidator('ContestListItem');
    const valid = validate(item);

    if (!valid) {
      const errors = formatValidationErrors(validate.errors);
      throw new Error(`Item at index ${index} does not match ContestListItem schema:\n${errors}`);
    }
  });
}

/**
 * Format validation errors for readable output
 * @param {array} errors - AJV validation errors
 * @returns {string} Formatted error message
 */
function formatValidationErrors(errors) {
  return errors
    .slice(0, 5) // Show first 5 errors to avoid overwhelming output
    .map(err => {
      const path = err.instancePath || 'root';
      const keyword = err.keyword;
      const message = err.message;
      return `  ${path} ${keyword}: ${message}`;
    })
    .join('\n') +
    (errors.length > 5 ? `\n  ... and ${errors.length - 5} more errors` : '');
}

module.exports = {
  assertMatchesContestDetailSchema,
  assertMatchesContestListItemSchema,
  assertMatchesContestListSchema
};
