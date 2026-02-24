/**
 * OpenAPI Breaking Change Detector
 *
 * Compares the current contracts/openapi.yaml against the version on the main branch.
 * Detects breaking changes using git show to read the main branch spec locally.
 * Does not require external services.
 *
 * Breaking changes detected:
 *   - Path removed
 *   - HTTP method removed from an existing path
 *   - Required request body field removed
 *
 * Non-breaking changes are allowed:
 *   - New paths added
 *   - New methods added
 *   - New optional fields added
 *   - Response schema additions
 *
 * Exit 0 if no breaking changes (or if main branch spec is unavailable).
 * Exit 1 on breaking changes.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const OPENAPI_PATH = path.resolve(__dirname, '../contracts/openapi.yaml');
const VALID_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Attempt to read contracts/openapi.yaml from the main branch using git.
 * Returns null if the file does not exist on main or git is unavailable.
 */
function getMainBranchSpec() {
  try {
    const raw = execSync('git show main:backend/contracts/openapi.yaml', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return yaml.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build a map of path → Set<method> from an OpenAPI spec.
 */
function buildRouteMap(spec) {
  const map = new Map();
  for (const [pathKey, pathObj] of Object.entries(spec.paths || {})) {
    const methods = Object.keys(pathObj).filter(m => VALID_METHODS.includes(m));
    if (methods.length > 0) {
      map.set(pathKey, new Set(methods));
    }
  }
  return map;
}

/**
 * Return required request body fields for a given operation, or [].
 */
function getRequiredBodyFields(op) {
  if (!op || typeof op !== 'object') return [];
  const schema = op.requestBody?.content?.['application/json']?.schema;
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required;
}

function checkOpenApiDiff() {
  // ── 1. Read main branch spec ───────────────────────────────────────────────
  const mainSpec = getMainBranchSpec();

  if (!mainSpec) {
    console.log('⚠  Could not read main:backend/contracts/openapi.yaml — skipping diff check');
    console.log('   (This is expected on a new branch or if main does not have this file yet)');
    process.exit(0);
  }

  // ── 2. Read current spec ───────────────────────────────────────────────────
  if (!fs.existsSync(OPENAPI_PATH)) {
    console.error('ERROR: contracts/openapi.yaml not found');
    process.exit(1);
  }

  const currentContent = fs.readFileSync(OPENAPI_PATH, 'utf8');
  const currentSpec = yaml.parse(currentContent);

  // ── 3. Compare ─────────────────────────────────────────────────────────────
  const mainRoutes = buildRouteMap(mainSpec);
  const currentRoutes = buildRouteMap(currentSpec);

  const errors = [];

  for (const [pathKey, mainMethods] of mainRoutes) {
    // Breaking: path removed
    if (!currentRoutes.has(pathKey)) {
      errors.push(`Path removed: ${pathKey}`);
      continue;
    }

    const currentMethods = currentRoutes.get(pathKey);

    for (const method of mainMethods) {
      // Breaking: method removed
      if (!currentMethods.has(method)) {
        errors.push(`Method removed: ${method.toUpperCase()} ${pathKey}`);
        continue;
      }

      // Breaking: required request body field removed
      const mainOp = mainSpec.paths[pathKey]?.[method];
      const currentOp = currentSpec.paths[pathKey]?.[method];

      const mainRequired = getRequiredBodyFields(mainOp);
      const currentRequired = getRequiredBodyFields(currentOp);

      for (const field of mainRequired) {
        if (!currentRequired.includes(field)) {
          errors.push(
            `Required request body field removed: ${method.toUpperCase()} ${pathKey} → body.${field}`
          );
        }
      }
    }
  }

  // ── 4. Report ──────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.error('BREAKING OpenAPI changes detected vs main branch:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Report additions (non-breaking, informational)
  const addedPaths = [];
  for (const pathKey of currentRoutes.keys()) {
    if (!mainRoutes.has(pathKey)) addedPaths.push(pathKey);
  }

  if (addedPaths.length > 0) {
    console.log(`✓ No breaking changes (${addedPaths.length} new path(s) added vs main)`);
  } else {
    console.log('✓ No breaking changes vs main branch');
  }
}

checkOpenApiDiff();
