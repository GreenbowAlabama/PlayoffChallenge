/**
 * OpenAPI Structural Validator
 *
 * Validates that contracts/openapi.yaml is structurally sound.
 * Does not require a database or external services.
 *
 * Checks:
 *   1. File exists and parses as valid YAML
 *   2. Top-level openapi: 3.x.x field
 *   3. Required info.title and info.version
 *   4. paths object is present and non-empty
 *   5. Each path starts with /
 *   6. Each path has at least one valid HTTP method
 *   7. Each method has a responses object
 *
 * Exit 1 on any failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const OPENAPI_PATH = path.resolve(__dirname, '../contracts/openapi.yaml');
const VALID_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function validateOpenApi() {
  // 1. File must exist
  if (!fs.existsSync(OPENAPI_PATH)) {
    console.error(`ERROR: openapi.yaml not found at ${OPENAPI_PATH}`);
    process.exit(1);
  }

  // 2. File must parse as valid YAML
  let spec;
  try {
    const content = fs.readFileSync(OPENAPI_PATH, 'utf8');
    spec = yaml.parse(content);
  } catch (err) {
    console.error(`ERROR: Failed to parse openapi.yaml: ${err.message}`);
    process.exit(1);
  }

  const errors = [];

  // 3. Must be a non-null object
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    console.error('ERROR: openapi.yaml root must be an object');
    process.exit(1);
  }

  // 4. openapi version field
  if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.')) {
    errors.push(`openapi field must be 3.x.x — got: ${JSON.stringify(spec.openapi)}`);
  }

  // 5. info object
  if (!spec.info || typeof spec.info !== 'object') {
    errors.push('Missing required field: info');
  } else {
    if (!spec.info.title) errors.push('Missing required field: info.title');
    if (!spec.info.version) errors.push('Missing required field: info.version');
  }

  // 6. paths object
  if (!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) {
    errors.push('Missing required field: paths (must be an object)');
  } else {
    const pathKeys = Object.keys(spec.paths);

    if (pathKeys.length === 0) {
      errors.push('paths object is empty — at least one path is required');
    }

    for (const pathKey of pathKeys) {
      // Path must start with /
      if (!pathKey.startsWith('/')) {
        errors.push(`Path must start with /: ${pathKey}`);
      }

      const pathObj = spec.paths[pathKey];
      if (!pathObj || typeof pathObj !== 'object') {
        errors.push(`Path ${pathKey} must be an object`);
        continue;
      }

      // Must have at least one valid HTTP method
      const methods = Object.keys(pathObj).filter(k => VALID_METHODS.includes(k));
      if (methods.length === 0) {
        errors.push(`Path ${pathKey} has no valid HTTP methods (got: ${Object.keys(pathObj).join(', ')})`);
      }

      // Each method must have a responses object
      for (const method of methods) {
        const op = pathObj[method];
        if (!op || typeof op !== 'object') {
          errors.push(`${method.toUpperCase()} ${pathKey}: operation must be an object`);
          continue;
        }
        if (!op.responses || typeof op.responses !== 'object' || Object.keys(op.responses).length === 0) {
          errors.push(`${method.toUpperCase()} ${pathKey}: missing responses object`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('OpenAPI validation FAILED:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  const pathCount = Object.keys(spec.paths).length;
  console.log(`✓ openapi.yaml is valid (${pathCount} paths, OpenAPI ${spec.openapi})`);
}

validateOpenApi();
