/**
 * Contract Validation Middleware
 *
 * Validates API response bodies against the OpenAPI schema in dev/test modes.
 * Spec is authoritative. Backend must conform to spec, not vice versa.
 *
 * Behavior:
 * - Production: no-op (zero overhead)
 * - Dev/Test: validate response, throw Error on violation (fail hard)
 *
 * Usage in routes:
 *   router.get('/:id', ..., createContractValidator('ContestDetailResponse'));
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const yaml = require('yaml');

let schemaCache = null;
let validatorCache = {};

/**
 * Load and parse the OpenAPI spec from contracts/openapi.yaml
 * @returns {Object} Parsed OpenAPI spec
 */
function loadOpenApiSpec() {
  if (schemaCache) return schemaCache;

  const specPath = path.join(__dirname, '../contracts/openapi.yaml');
  const specContent = fs.readFileSync(specPath, 'utf8');
  schemaCache = yaml.parse(specContent);
  return schemaCache;
}

/**
 * Get or create a JSON Schema validator for a component schema
 * @param {string} schemaName - Component schema name (e.g., 'ContestDetailResponse')
 * @returns {Function} AJV validator function
 */
function getValidator(schemaName) {
  if (validatorCache[schemaName]) {
    return validatorCache[schemaName];
  }

  const spec = loadOpenApiSpec();
  const componentSchema = spec.components.schemas[schemaName];

  if (!componentSchema) {
    throw new Error(`Schema '${schemaName}' not found in openapi.yaml components`);
  }

  // Convert OpenAPI schema to JSON Schema
  const jsonSchema = convertOpenApiToJsonSchema(componentSchema, spec.components.schemas);

  // Create AJV validator
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  const validator = ajv.compile(jsonSchema);
  validatorCache[schemaName] = validator;

  return validator;
}

/**
 * Convert OpenAPI schema to JSON Schema (handle $ref, nullable, etc.)
 * @param {Object} schema - OpenAPI schema object
 * @param {Object} components - Component schemas for $ref resolution
 * @returns {Object} JSON Schema
 */
function convertOpenApiToJsonSchema(schema, components) {
  const converted = { ...schema };

  // Handle $ref references
  if (converted.$ref) {
    const refName = converted.$ref.split('/').pop();
    const refSchema = components[refName];
    if (refSchema) {
      return convertOpenApiToJsonSchema(refSchema, components);
    }
  }

  // Handle OpenAPI 'nullable' by expanding type to include null
  if (converted.nullable === true) {
    const baseType = converted.type;
    if (baseType) {
      converted.type = [baseType, 'null'];
    }
    delete converted.nullable;
  }

  // Recursively process nested schemas
  if (converted.properties) {
    Object.keys(converted.properties).forEach(key => {
      converted.properties[key] = convertOpenApiToJsonSchema(converted.properties[key], components);
    });
  }

  if (converted.items) {
    converted.items = convertOpenApiToJsonSchema(converted.items, components);
  }

  // Handle allOf, anyOf, oneOf
  ['allOf', 'anyOf', 'oneOf'].forEach(keyword => {
    if (converted[keyword]) {
      converted[keyword] = converted[keyword].map(s => convertOpenApiToJsonSchema(s, components));
    }
  });

  return converted;
}

/**
 * Format validation errors for readable output
 * @param {Array} errors - AJV validation errors
 * @returns {string} Formatted error message
 */
function formatValidationErrors(errors) {
  return errors
    .map(err => {
      const path = err.instancePath || 'root';
      const keyword = err.keyword;
      const message = err.message;
      return `  ${path} ${keyword}: ${message}`;
    })
    .join('\n');
}

/**
 * Create validation middleware for a specific schema.
 *
 * Production: returns no-op middleware (zero overhead).
 * Dev/Test: wraps res.json to validate and throw on violation.
 *
 * @param {string} schemaName - Component schema name
 * @returns {Function} Express middleware
 */
function createContractValidator(schemaName) {
  // In production, no-op middleware (zero validation overhead)
  if (process.env.NODE_ENV === 'production') {
    return (req, res, next) => next();
  }

  // Dev/Test: validate and fail hard
  return (req, res, next) => {
    const originalJson = res.json;

    res.json = function(data) {
      // Only validate 2xx responses (success).
      // Error responses (4xx, 5xx) have their own error shape and don't need schema validation.
      const statusCode = res.statusCode || 200;
      const isSuccessResponse = statusCode >= 200 && statusCode < 300;

      if (isSuccessResponse) {
        // Get validator for this schema
        const validate = getValidator(schemaName);

        // Validate response body
        const valid = validate(data);

        if (!valid) {
          const errors = validate.errors;
          const errorMessage = `CONTRACT VIOLATION for ${schemaName}:\n${formatValidationErrors(errors)}`;

          // Fail hard — throw error, do not send response
          const err = new Error(errorMessage);
          err.validationErrors = errors;
          err.statusCode = 500;
          throw err;
        }
      }

      // Validation passed (or skipped for error responses) — send response
      return originalJson.call(this, data);
    };

    next();
  };
}

module.exports = {
  createContractValidator,
  getValidator,
  loadOpenApiSpec
};
