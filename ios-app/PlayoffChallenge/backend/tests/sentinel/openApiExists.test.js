/**
 * Sentinel: OpenAPI Contract Exists
 *
 * Ensures contracts/openapi.yaml:
 *   1. Exists on disk
 *   2. Parses as valid YAML without throwing
 *   3. Has the required OpenAPI 3.0 top-level structure
 *
 * This is a fast, DB-free structural guard.
 * Full content freeze is enforced by tests/contract-freeze.test.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const CONTRACT_PATH = path.resolve(__dirname, '../../contracts/openapi.yaml');

describe('sentinel: openapi.yaml', () => {
  it('exists on disk', () => {
    expect(fs.existsSync(CONTRACT_PATH)).toBe(true);
  });

  it('parses as valid YAML without throwing', () => {
    const content = fs.readFileSync(CONTRACT_PATH, 'utf8');
    let parsed;
    expect(() => {
      parsed = yaml.parse(content);
    }).not.toThrow();
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');
  });

  it('has required OpenAPI 3.0 structure', () => {
    const content = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const spec = yaml.parse(content);

    expect(typeof spec.openapi).toBe('string');
    expect(spec.openapi).toMatch(/^3\./);

    expect(spec.info).toBeDefined();
    expect(typeof spec.info.title).toBe('string');
    expect(spec.info.title.length).toBeGreaterThan(0);
    expect(typeof spec.info.version).toBe('string');
    expect(spec.info.version.length).toBeGreaterThan(0);

    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('has no empty path entries', () => {
    const content = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const spec = yaml.parse(content);
    const validMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

    for (const [pathKey, pathObj] of Object.entries(spec.paths)) {
      const methods = Object.keys(pathObj || {}).filter(k => validMethods.includes(k));
      expect(methods.length).toBeGreaterThan(0);
    }
  });
});
