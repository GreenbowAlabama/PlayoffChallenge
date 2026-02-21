/**
 * Platform Sport-Agnosticism Sentinel
 *
 * Structural checks to enforce that platform-level service files
 * dispatch to strategy implementations rather than containing
 * sport-specific logic directly.
 *
 * Strategy implementations (services/strategies/*) are allowed to
 * contain sport-specific code.
 */

const fs = require('fs');
const path = require('path');

describe('Platform Sport-Agnosticism Sentinel', () => {
  const servicesDir = path.join(__dirname, '../../services');

  describe('scoringService.js dispatches through registry', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(servicesDir, 'scoringService.js'), 'utf8');
    });

    it('should import from scoringRegistry', () => {
      expect(content).toMatch(/require\(.*scoringRegistry.*\)/);
    });

    it('should NOT directly query the database', () => {
      expect(content).not.toMatch(/pool\.query/);
      expect(content).not.toMatch(/client\.query/);
    });

    it('should NOT contain the scoring_rules SQL query', () => {
      expect(content).not.toMatch(/scoring_rules/);
    });
  });

  describe('scoringRegistry.js imports from strategies/', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(servicesDir, 'scoringRegistry.js'), 'utf8');
    });

    it('should import from strategies directory', () => {
      expect(content).toMatch(/require\(.*strategies\//);
    });

    it('should NOT contain SQL queries', () => {
      expect(content).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/);
    });
  });

  describe('settlementRegistry.js imports from strategies/', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(servicesDir, 'settlementRegistry.js'), 'utf8');
    });

    it('should import from strategies directory', () => {
      expect(content).toMatch(/require\(.*strategies\//);
    });

    it('should NOT contain SQL queries', () => {
      expect(content).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/);
    });
  });

  describe('NFL scoring logic lives only in strategies/', () => {
    it('should have nflScoring.js in strategies directory', () => {
      const filePath = path.join(servicesDir, 'strategies', 'nflScoring.js');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should have nflSettlement.js in strategies directory', () => {
      const filePath = path.join(servicesDir, 'strategies', 'nflSettlement.js');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
