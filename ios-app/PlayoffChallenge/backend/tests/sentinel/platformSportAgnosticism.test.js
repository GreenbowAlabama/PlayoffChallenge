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

  describe('scoring_strategy_key dispatch — Phase 2 + V1 ingestion boundary', () => {
    // Phase 2: scoring_strategy_key reading moved from server.js to ingestionService.js
    // (ingestionService joins contest_templates and passes key through adapter ctx)

    it('server.js delegates scoring to ingestionService (no direct contest_templates query)', () => {
      const serverPath = path.join(__dirname, '../../server.js');
      const serverContent = fs.readFileSync(serverPath, 'utf8');
      expect(serverContent).toMatch(/ingestionService\.run/);
    });

    it('ingestionService.js loads scoring_strategy_key from contest_templates', () => {
      const svcPath = path.join(servicesDir, 'ingestionService.js');
      const svcContent = fs.readFileSync(svcPath, 'utf8');
      expect(svcContent).toMatch(/contest_templates/);
      expect(svcContent).toMatch(/scoring_strategy_key/);
    });

    it('nflEspnIngestion adapter does NOT hardcode scoring strategy key', () => {
      const adapterPath = path.join(servicesDir, 'ingestion', 'strategies', 'nflEspnIngestion.js');
      const adapterContent = fs.readFileSync(adapterPath, 'utf8');
      // Strategy key must come from ctx.template, not be hardcoded as 'ppr'
      expect(adapterContent).not.toMatch(/'ppr'/);
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
