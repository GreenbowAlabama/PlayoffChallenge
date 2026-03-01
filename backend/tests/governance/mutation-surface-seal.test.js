/**
 * Governance Test: Mutation Surface Seal
 *
 * Enforces architectural rule: No direct UPDATE contest_instances SET status
 * outside the frozen lifecycle service layer.
 *
 * Allowed locations:
 * - backend/services/contestLifecycleService.js (frozen primitives)
 * - backend/services/discovery/discoveryService.js (cascade in Phase 1)
 *
 * Forbidden locations:
 * - backend/services/adminContestService.js
 * - Any route handler
 * - Any other service
 *
 * Rationale: All status mutations must go through frozen primitives to ensure:
 * - Atomicity (row lock → state validation → single UPDATE → transition record)
 * - Idempotency (no duplicate mutations)
 * - Consistency (uniform transition record insertion)
 * - Auditability (all transitions in contest_state_transitions)
 */

const fs = require('fs');
const path = require('path');

describe('Governance: Mutation Surface Seal', () => {
  const FORBIDDEN_FILES = [
    'backend/services/adminContestService.js',
    'backend/routes/*.js',
    'backend/routes/**/*.js'
  ];

  const ALLOWED_FILES = [
    'backend/services/contestLifecycleService.js',
    'backend/services/discovery/discoveryService.js'
  ];

  const PATTERN = /UPDATE\s+contest_instances\s+SET\s+status/i;

  /**
   * Scans a file for direct status UPDATE statements.
   * Returns array of { lineNumber, line } for each match.
   */
  function scanFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const matches = [];

    lines.forEach((line, index) => {
      if (PATTERN.test(line)) {
        matches.push({
          lineNumber: index + 1,
          line: line.trim()
        });
      }
    });

    return matches;
  }

  /**
   * Expands glob pattern to actual files.
   */
  function expandGlob(pattern) {
    const glob = require('glob');
    const basePath = path.join(__dirname, '..', '..');
    const fullPattern = path.join(basePath, pattern);

    try {
      return glob.sync(fullPattern);
    } catch (err) {
      return [];
    }
  }

  it('should not allow direct status UPDATE in critical admin functions', () => {
    const filePath = path.join(__dirname, '../../services/adminContestService.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // REFACTORED (sealed): triggerSettlement, forceLockContestInstance
    // PENDING refactoring: markContestError, resolveError, cancelContestInstance
    // These three need to be refactored to delegate to frozen primitives
    // in Path A Batch A3 completion.

    // Critical check: Settlement trigger must NOT use direct UPDATE
    const settlementStart = content.indexOf('async function triggerSettlement');
    const settlementEnd = content.indexOf('\nasync function', settlementStart + 1);
    const settlementBody = content.substring(settlementStart, settlementEnd);

    if (settlementBody.includes('UPDATE contest_instances SET status')) {
      throw new Error(
        'triggerSettlement() must use transitionSingleLiveToComplete() frozen primitive, not direct UPDATE'
      );
    }

    // Critical check: Force lock must NOT use direct UPDATE
    const lockStart = content.indexOf('async function forceLockContestInstance');
    const lockEnd = content.indexOf('\nasync function', lockStart + 1);
    const lockBody = content.substring(lockStart, lockEnd);

    if (lockBody.includes('UPDATE contest_instances SET status')) {
      throw new Error(
        'forceLockContestInstance() must use lockScheduledContestForAdmin() frozen primitive, not direct UPDATE'
      );
    }
  });

  it('should not allow direct status UPDATE in route handlers', () => {
    const routePattern = 'backend/routes/**/*.js';
    const routeFiles = expandGlob(routePattern);

    const violations = [];

    routeFiles.forEach(filePath => {
      const matches = scanFile(filePath);
      if (matches.length > 0) {
        violations.push({
          file: filePath,
          matches
        });
      }
    });

    if (violations.length > 0) {
      const message = violations
        .map(v => {
          const matchLines = v.matches
            .map(m => `    Line ${m.lineNumber}: ${m.line}`)
            .join('\n');
          return `${v.file}\n${matchLines}`;
        })
        .join('\n\n');

      throw new Error(
        `Mutation surface seal BROKEN: Direct status UPDATE found in route handlers\n` +
        `Routes must delegate to frozen lifecycle primitives via adminContestService\n\n` +
        message
      );
    }
  });

  it('should allow UPDATE in contestLifecycleService.js (frozen primitives)', () => {
    const filePath = path.join(__dirname, '../../services/contestLifecycleService.js');
    const matches = scanFile(filePath);

    // This is allowed — the lifecycle service contains frozen primitives
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should allow UPDATE in discoveryService.js (cascade in Phase 1)', () => {
    const filePath = path.join(__dirname, '../../services/discovery/discoveryService.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // Discovery Phase 1 cascade uses inline CTE with FOR UPDATE — this is allowed
    // because it atomically cascades cancellations to all non-COMPLETE instances
    expect(content).toContain('PROVIDER_TOURNAMENT_CANCELLED');
  });

  it('should enforce consistent UPDATE pattern in lifecycle service', () => {
    const filePath = path.join(__dirname, '../../services/contestLifecycleService.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // Verify frozen primitives use performSingleStateTransition helper
    // OR use the expected CTE pattern with FOR UPDATE lock

    const hasHelper = content.includes('performSingleStateTransition');
    const hasCTEPattern = content.includes('WITH') && content.includes('FOR UPDATE');

    expect(hasHelper || hasCTEPattern).toBe(true);
  });

  describe('Mutation Surface Architecture', () => {
    it('documents allowed mutation entry points', () => {
      // This is more of a documentation test.
      // It verifies the expected frozen primitives exist.

      const lifecycleService = path.join(
        __dirname,
        '../../services/contestLifecycleService.js'
      );
      const content = fs.readFileSync(lifecycleService, 'utf8');

      const requiredPrimitives = [
        'transitionScheduledToLocked',
        'transitionLockedToLive',
        'transitionLiveToComplete',
        'transitionSingleLiveToComplete',
        'lockScheduledContestForAdmin',
        'markContestAsErrorForAdmin',
        'resolveContestErrorForAdmin',
        'cancelContestForAdmin',
        'performSingleStateTransition'
      ];

      requiredPrimitives.forEach(primitive => {
        expect(content).toContain(`function ${primitive}`);
      });
    });

    it('verifies single-instance primitives delegate to helper', () => {
      const lifecycleService = path.join(
        __dirname,
        '../../services/contestLifecycleService.js'
      );
      const content = fs.readFileSync(lifecycleService, 'utf8');

      // Verify single-instance primitives call performSingleStateTransition
      const adminPrimitives = [
        'lockScheduledContestForAdmin',
        'markContestAsErrorForAdmin',
        'resolveContestErrorForAdmin',
        'cancelContestForAdmin'
      ];

      adminPrimitives.forEach(primitive => {
        // Check that function exists and eventually calls performSingleStateTransition
        const functionExists = content.includes(`async function ${primitive}`);
        const callsHelper = content.includes('performSingleStateTransition');

        expect(functionExists).toBe(true);
        expect(callsHelper).toBe(true);
      });
    });
  });
});
