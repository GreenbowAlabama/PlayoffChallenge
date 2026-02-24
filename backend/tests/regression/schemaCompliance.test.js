/**
 * Schema Compliance Regression Tests
 *
 * Purpose: Ensure production code does not reference legacy or non-existent tables.
 *
 * Background:
 * - The database uses contest_instances and contest_templates (NOT a "contests" table)
 * - Legacy code incorrectly referenced a "contests" table that doesn't exist
 * - This test prevents regression to legacy table references
 */

const fs = require('fs');
const path = require('path');

/**
 * Recursively get all .js files in a directory, excluding tests and node_modules
 */
function getProductionFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip test directories and node_modules
      if (item === 'tests' || item === 'node_modules' || item === 'coverage') {
        continue;
      }
      getProductionFiles(fullPath, files);
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Schema Compliance', () => {
  const backendDir = path.join(__dirname, '..', '..');
  const productionFiles = getProductionFiles(backendDir);

  describe('No legacy "contests" table references in production code', () => {
    // Patterns that indicate a legacy reference to the non-existent "contests" table
    const legacyPatterns = [
      /FROM\s+contests\b/i,
      /JOIN\s+contests\b/i,
      /INTO\s+contests\b/i,
      /UPDATE\s+contests\b/i,
      /DELETE\s+FROM\s+contests\b/i,
    ];

    // Files that are explicitly allowed to reference "contests"
    // These are legacy files that are no longer used in production code paths
    // but are kept for backward compatibility with existing test infrastructure.
    // DO NOT add new files here. Fix any new violations instead.
    const allowedFiles = [
      'services/contestService.js', // LEGACY: Not used in production. Tests only.
    ];

    productionFiles.forEach((filePath) => {
      const relativePath = path.relative(backendDir, filePath);

      // Skip allowed files
      if (allowedFiles.includes(relativePath)) {
        return;
      }

      it(`${relativePath} should not reference legacy "contests" table`, () => {
        const content = fs.readFileSync(filePath, 'utf8');
        const violations = [];

        for (const pattern of legacyPatterns) {
          const match = content.match(pattern);
          if (match) {
            // Find the line number
            const lines = content.substring(0, match.index).split('\n');
            const lineNumber = lines.length;
            violations.push({
              pattern: pattern.toString(),
              match: match[0],
              line: lineNumber,
            });
          }
        }

        if (violations.length > 0) {
          const details = violations.map(v =>
            `  Line ${v.line}: "${v.match}" (matched ${v.pattern})`
          ).join('\n');
          expect(violations).toEqual([]);
          // Note: If this fails, the file references the legacy "contests" table.
          // Use contest_instances and contest_templates instead.
        }
      });
    });

    it('should have scanned at least some production files', () => {
      expect(productionFiles.length).toBeGreaterThan(5);
    });
  });

  describe('Database table naming conventions', () => {
    it('should use contest_instances for user-created contests', () => {
      // Verify the correct table is referenced in customContestService
      const servicePath = path.join(backendDir, 'services', 'customContestService.js');
      const content = fs.readFileSync(servicePath, 'utf8');

      expect(content).toMatch(/FROM\s+contest_instances/i);
      expect(content).toMatch(/INSERT\s+INTO\s+contest_instances/i);
    });

    it('should use contest_templates for template definitions', () => {
      const servicePath = path.join(backendDir, 'services', 'customContestService.js');
      const content = fs.readFileSync(servicePath, 'utf8');

      expect(content).toMatch(/FROM\s+contest_templates/i);
    });
  });
});
