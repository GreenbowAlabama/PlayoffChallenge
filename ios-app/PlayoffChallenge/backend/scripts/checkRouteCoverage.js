/**
 * Route Coverage Check
 *
 * Bidirectional coverage enforcement between Express routes and contracts/openapi.yaml.
 * Does not require a database or external services.
 *
 * Strategy:
 *   Load each public route module directly (not via app.js) to avoid Express 5
 *   internal router structure changes. Each module is loaded with its known mount
 *   prefix and its routes are compared against openapi.yaml.
 *
 * Scope:
 *   - Public route modules: custom-contests, payments, webhooks
 *   - Auth routes registered directly in server.js (static list below)
 *   - Admin routes are excluded — not in openapi.yaml by design
 *   - Legacy game routes are excluded by design
 *
 * Checks:
 *   1. Forward: every path+method in openapi.yaml has a real Express handler
 *   2. Backward: every route in public modules is documented in openapi.yaml
 *
 * Exit 1 on any mismatch.
 */

'use strict';

// Load .env before requiring route modules — some services (e.g. StripeWebhookService)
// instantiate clients at module load time and require env vars to be present.
// For route introspection we do not make real service calls, so a placeholder is safe.
require('dotenv').config();
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_route_introspection_only';
}

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// ── Configuration ─────────────────────────────────────────────────────────────

// Route modules that constitute the public API and must be fully documented.
// Each entry pairs the route module path with its Express mount prefix.
const PUBLIC_ROUTE_MODULES = [
  { modulePath: '../routes/customContest.routes', mountPrefix: '/api/custom-contests' },
  { modulePath: '../routes/payments',             mountPrefix: '/api/payments' },
  { modulePath: '../routes/webhooks',             mountPrefix: '/api/webhooks' },
];

// Routes registered directly in server.js (not in any route module).
// These ARE documented in openapi.yaml and are included in forward coverage.
// Update this list if server.js auth routes change.
const SERVER_DIRECT_ROUTES = [
  { method: 'POST',   path: '/api/users' },
  { method: 'POST',   path: '/api/auth/register' },
  { method: 'POST',   path: '/api/auth/login' },
  { method: 'DELETE', path: '/api/user' },
];

const VALID_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert Express parameter syntax to OpenAPI parameter syntax.
 * /api/custom-contests/:id/join → /api/custom-contests/{id}/join
 */
function toOpenApiPath(expressPath) {
  return expressPath.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Extract route definitions from an Express Router's stack.
 * Returns an array of { method, path } pairs for direct route handlers.
 * Does not recurse into nested routers (public route modules are flat).
 */
function extractRoutesFromStack(stack) {
  const routes = [];
  if (!Array.isArray(stack)) return routes;

  for (const layer of stack) {
    if (!layer || typeof layer !== 'object') continue;
    if (!layer.route || typeof layer.route.path !== 'string') continue;

    const methods = Object.keys(layer.route.methods || {}).filter(m => VALID_METHODS.includes(m));
    for (const method of methods) {
      routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return routes;
}

/**
 * Load a route module and extract its routes with the full mount prefix applied.
 */
function loadModuleRoutes(modulePath, mountPrefix) {
  try {
    const router = require(modulePath);
    // Express 5 Router exposes .stack directly on the router function
    const stack = router.stack || [];
    const relative = extractRoutesFromStack(stack);
    return relative.map(r => ({
      method: r.method,
      path: mountPrefix + (r.path === '/' ? '' : r.path),
    }));
  } catch (err) {
    console.error(`ERROR: Failed to load route module ${modulePath}: ${err.message}`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function checkRouteCoverage() {
  // ── 1. Parse openapi.yaml ──────────────────────────────────────────────────
  const openapiPath = path.resolve(__dirname, '../contracts/openapi.yaml');

  if (!fs.existsSync(openapiPath)) {
    console.error('ERROR: contracts/openapi.yaml not found. Run validateOpenApi.js first.');
    process.exit(1);
  }

  const content = fs.readFileSync(openapiPath, 'utf8');
  const spec = yaml.parse(content);

  // Build set of documented routes: "METHOD /path"
  const documentedRoutes = new Set();
  for (const [pathKey, pathObj] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(pathObj)) {
      if (VALID_METHODS.includes(method)) {
        documentedRoutes.add(`${method.toUpperCase()} ${pathKey}`);
      }
    }
  }

  // ── 2. Load all public module routes ──────────────────────────────────────
  const moduleRoutes = [];
  for (const { modulePath, mountPrefix } of PUBLIC_ROUTE_MODULES) {
    const routes = loadModuleRoutes(path.resolve(__dirname, modulePath), mountPrefix);
    moduleRoutes.push(...routes);
  }

  // Build normalised Express route set: "METHOD /api/path/{param}"
  const allExpressRoutes = [...moduleRoutes, ...SERVER_DIRECT_ROUTES];
  const expressRouteSet = new Set(
    allExpressRoutes.map(r => `${r.method} ${toOpenApiPath(r.path)}`)
  );

  // ── 3. Forward coverage: openapi.yaml → Express ───────────────────────────
  // Every documented route must have a real handler.
  const errors = [];

  for (const docRoute of documentedRoutes) {
    if (!expressRouteSet.has(docRoute)) {
      errors.push(`DOCUMENTED BUT MISSING IN EXPRESS: ${docRoute}`);
    }
  }

  // ── 4. Backward coverage: Express → openapi.yaml ─────────────────────────
  // Every route from public modules + server direct routes must be documented.
  for (const route of allExpressRoutes) {
    const key = `${route.method} ${toOpenApiPath(route.path)}`;
    if (!documentedRoutes.has(key)) {
      errors.push(`UNDOCUMENTED ROUTE: ${key}`);
    }
  }

  // ── 5. Report ──────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    console.error('Route coverage check FAILED:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(
    `✓ Route coverage OK` +
    ` (${documentedRoutes.size} documented,` +
    ` ${allExpressRoutes.length} express routes checked)`
  );
}

checkRouteCoverage();
