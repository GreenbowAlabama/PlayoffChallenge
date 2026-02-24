/**
 * Contract Freeze Test
 *
 * This test ensures the OpenAPI contract (openapi.yaml) does not drift
 * without explicit, intentional updates.
 *
 * If you need to update the contract:
 * 1. Make your changes to openapi.yaml
 * 2. Run: npm test -- --updateSnapshot
 * 3. Commit the updated contract hash
 *
 * This prevents silent contract changes from entering production.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

describe('Contract Freeze', () => {
  const contractPath = path.resolve(
    __dirname,
    '../contracts/openapi.yaml'
  );

  it('should not allow openapi.yaml to drift without explicit update', () => {
    // Read current contract
    const content = fs.readFileSync(contractPath, 'utf8');
    const currentHash = crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');

    // Expected hash (update this when intentionally changing the contract)
    // This hash was generated after UI-Contract Parity Audit (2026-02-19):
    // - Added organizer_name (optional, nullable) to ContestDetailResponse
    // - Added lock_time (optional, nullable) to ContestDetailResponse
    // - Brings detail endpoint into parity with list endpoint
    const expectedHash = 'ac4418fb2ffd764558c1749c308fc2806b92cdc42019c6840d9da38f84268a2c';

    // The hashes must match - if they don't, the contract has drifted
    expect(currentHash).toBe(expectedHash);
  });

  it('should verify all required routes are documented', () => {
    const content = fs.readFileSync(contractPath, 'utf8');

    // Required core contest routes
    const requiredPaths = [
      '/api/custom-contests/templates',
      '/api/custom-contests/join',
      '/api/custom-contests',
      '/api/custom-contests/{id}/publish',
      '/api/custom-contests/{id}/status',
      '/api/custom-contests/{id}/join',
      '/api/custom-contests/{id}/leaderboard',
      '/api/custom-contests/{id}',
      '/api/custom-contests/{id}/entry',
      '/api/custom-contests/available',
      '/api/payments/intents',
      '/api/webhooks/stripe',
      '/api/users',
      '/api/auth/register',
      '/api/auth/login',
      '/api/user'
    ];

    requiredPaths.forEach((path) => {
      expect(content).toContain(path);
    });
  });

  it('should verify ErrorCode enum is properly defined', () => {
    const content = fs.readFileSync(contractPath, 'utf8');

    // Required error codes
    const requiredErrorCodes = [
      'CONTEST_NOT_FOUND',
      'CONTEST_DELETE_NOT_ALLOWED',
      'CONTEST_UNJOIN_NOT_ALLOWED',
      'ALREADY_JOINED',
      'CONTEST_FULL',
      'CONTEST_LOCKED',
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'PAYMENT_INTENT_NOT_FOUND',
      'STRIPE_SIGNATURE_INVALID',
      'ACCOUNT_DELETION_BLOCKED'
    ];

    requiredErrorCodes.forEach((code) => {
      expect(content).toContain(`- ${code}`);
    });
  });

  it('should verify no admin-only routes are documented', () => {
    const content = fs.readFileSync(contractPath, 'utf8');

    // Admin routes should NOT be in public contract
    const excludedPaths = [
      '/api/admin/contests',
      '/api/admin/custom-contests/templates',
      '/api/admin/diagnostics',
      '/api/admin/trends',
      '/api/admin/runbooks',
      '/api/admin/auth/apple'
    ];

    excludedPaths.forEach((path) => {
      // Check that path is NOT in the paths section (may exist in comments/descriptions)
      const pathsMatch = content.match(/^paths:\s*\n([\s\S]*?)^components:/m);
      if (pathsMatch) {
        const pathsSection = pathsMatch[1];
        expect(pathsSection).not.toContain(`  ${path}:`);
      }
    });
  });

  it('should verify no legacy game routes are documented', () => {
    const content = fs.readFileSync(contractPath, 'utf8');

    // Legacy routes should NOT be in public contract
    const legacyPatterns = [
      '/api/picks/',
      '/api/players',
      '/api/scores',
      '/api/leaderboard',
      '/api/game-config',
      '/api/live-stats',
      '/api/live-scores'
    ];

    const pathsMatch = content.match(/^paths:\s*\n([\s\S]*?)^components:/m);
    if (pathsMatch) {
      const pathsSection = pathsMatch[1];
      legacyPatterns.forEach((pattern) => {
        if (!pattern.endsWith('/')) {
          expect(pathsSection).not.toContain(`  ${pattern}:`);
        }
      });
    }
  });
});
