const { app } = require('../app');

/**
 * Recursively sort all keys in an object/array for deterministic output
 */
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Extract all routes from Express app recursively
 * Safely walks the router stack with defensive guards
 */
function extractRoutes(stack, basePath = '') {
  const routes = new Set();

  // Guard: stack must exist and be an array
  if (!stack || !Array.isArray(stack)) return routes;

  for (const layer of stack) {
    // Guard: layer must be an object
    if (!layer || typeof layer !== 'object') continue;

    let path = basePath;

    // Case 1: Direct route handler
    if (layer.route && typeof layer.route === 'object') {
      // Guard: route.path must exist
      if (typeof layer.route.path === 'string') {
        path = basePath + layer.route.path;
      } else {
        continue;
      }

      // Guard: route.methods must be an object
      if (!layer.route.methods || typeof layer.route.methods !== 'object') {
        continue;
      }

      // Extract and sort methods for determinism
      const methodKeys = Object.keys(layer.route.methods);
      if (methodKeys.length === 0) continue;

      const methods = methodKeys.sort();
      for (const method of methods) {
        routes.add({ method: method.toUpperCase(), path });
      }
    }
    // Case 2: Mounted router - recurse
    else if (layer.name === 'router' && layer.handle && typeof layer.handle === 'object') {
      // Guard: handle.stack must exist and be an array
      if (!Array.isArray(layer.handle.stack)) continue;

      // Extract mount path from regex or fallback to layer.path
      let mountPath = '';
      if (layer.regexp && typeof layer.regexp === 'object') {
        mountPath = extractMountPath(layer.regexp);
      }
      if (!mountPath && typeof layer.path === 'string') {
        mountPath = layer.path;
      }

      path = basePath + mountPath;
      const nestedRoutes = extractRoutes(layer.handle.stack, path);
      for (const route of nestedRoutes) {
        routes.add(route);
      }
    }
  }

  return routes;
}

/**
 * Extract mount path from router regex
 * Stable extraction with fallback handling
 */
function extractMountPath(regexp) {
  // Guard: regexp must be an object with source property
  if (!regexp || typeof regexp !== 'object' || typeof regexp.source !== 'string') {
    return '';
  }

  const source = regexp.source;

  // Guard: source must not be empty
  if (source.length === 0) return '';

  // Extract path: patterns start with ^ and end with various suffixes
  // Match from ^ to the first quantifier or lookahead
  let match = source.match(/^\^(.+?)(?:\$|\\\/|\(|\?)/);
  if (!match) {
    match = source.match(/^\^(.+)$/);
    if (!match) return '';
  }

  // Guard: match group 1 must exist
  if (!match[1] || typeof match[1] !== 'string') {
    return '';
  }

  let path = match[1];

  // Unescape forward slashes safely
  path = path.replace(/\\\//g, '/');

  return path;
}

/**
 * Generate minimal OpenAPI v3 spec from Express routes
 * Handles missing or malformed router gracefully
 */
function generateOpenAPISpec() {
  // Guard: app._router must exist
  let routes;
  if (app && app._router && app._router.stack) {
    routes = extractRoutes(app._router.stack);
  } else {
    routes = new Set();
  }

  // Build paths object
  const paths = {};

  for (const route of routes) {
    // Guard: route must have required properties
    if (!route || typeof route.path !== 'string' || typeof route.method !== 'string') {
      continue;
    }

    // Guard: path must not be empty
    if (route.path.length === 0) continue;

    if (!paths[route.path]) {
      paths[route.path] = {};
    }

    paths[route.path][route.method.toLowerCase()] = {
      responses: {
        '200': {
          description: 'OK'
        }
      }
    };
  }

  const spec = {
    openapi: '3.0.0',
    info: {
      title: '67 Enterprises API',
      version: 'v1'
    },
    paths
  };

  // Sort all keys recursively for deterministic output
  return sortObjectKeys(spec);
}

module.exports = { generateOpenAPISpec };
