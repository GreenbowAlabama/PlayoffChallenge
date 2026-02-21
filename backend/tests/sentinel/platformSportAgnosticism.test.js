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

  describe('scoringService.js does not contain hardcoded strategy keys (Phase 2)', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(servicesDir, 'scoringService.js'), 'utf8');
    });

    it('should NOT contain hardcoded strategy key ppr', () => {
      expect(content).not.toMatch(/'ppr'/);
    });
  });

  describe('settlementStrategy.js does not contain hardcoded strategy keys (Phase 2)', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(path.join(servicesDir, 'settlementStrategy.js'), 'utf8');
    });

    it('should NOT contain hardcoded strategy key final_standings', () => {
      expect(content).not.toMatch(/'final_standings'/);
    });
  });

  describe('server.js batch scoring reads scoring_strategy_key from contest_templates (Phase 2)', () => {
    let content;

    beforeAll(() => {
      const serverPath = path.join(__dirname, '../../server.js');
      content = fs.readFileSync(serverPath, 'utf8');
    });

    it('should query contest_templates for scoring_strategy_key in the scoring path', () => {
      expect(content).toMatch(/contest_templates/);
      expect(content).toMatch(/scoring_strategy_key/);
    });

    it('should NOT hardcode scoring strategy key in savePlayerScoresToDatabase', () => {
      // Extract the savePlayerScoresToDatabase function body
      const fnStart = content.indexOf('async function savePlayerScoresToDatabase');
      const fnEnd = content.indexOf('\nasync function ', fnStart + 1);
      const fnBody = content.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
      expect(fnBody).not.toMatch(/'ppr'/);
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
