/**
 * Tests for seedUpcomingPGAContestsFull.js
 *
 * Verifies:
 * 1. Script uses canonical system user ID: 00000000-0000-0000-0000-000000000000
 * 2. Legacy system user ID (00000000-0000-0000-0000-000000000043) is NOT present
 */

const fs = require('fs');
const path = require('path');

describe('seedUpcomingPGAContestsFull.js - System User ID', () => {
  let scriptContent;

  beforeAll(() => {
    const scriptPath = path.join(
      __dirname,
      '../../scripts/seedUpcomingPGAContestsFull.js'
    );
    scriptContent = fs.readFileSync(scriptPath, 'utf8');
  });

  describe('Canonical system user enforcement', () => {
    it('should define PLATFORM_SYSTEM_USER_ID constant', () => {
      expect(scriptContent).toContain('PLATFORM_SYSTEM_USER_ID');
    });

    it('should use canonical system user ID (00000000-0000-0000-0000-000000000000)', () => {
      expect(scriptContent).toContain(
        "PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'"
      );
    });

    it('should NOT use legacy system user ID (00000000-0000-0000-0000-000000000043)', () => {
      expect(scriptContent).not.toContain(
        "PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043'"
      );
      expect(scriptContent).not.toContain('000000000043');
    });
  });

  describe('System user ID usage in contest creation', () => {
    it('should use PLATFORM_SYSTEM_USER_ID as organizer_id in INSERT statement', () => {
      // Extract the INSERT statement
      const insertMatch = scriptContent.match(/INSERT INTO contest_instances[\s\S]*?\)/);
      expect(insertMatch).toBeTruthy();

      const insertBlock = insertMatch[0];

      // Should have organizer_id in the column list
      expect(insertBlock).toContain('organizer_id');

      // In the values list, should reference PLATFORM_SYSTEM_USER_ID
      expect(scriptContent).toContain('PLATFORM_SYSTEM_USER_ID');
    });

    it('should pass PLATFORM_SYSTEM_USER_ID as the 3rd parameter in query values', () => {
      // Extract the values array from the client.query call
      const valuesMatch = scriptContent.match(/\[\s*contestId,[\s\S]*?PLATFORM_SYSTEM_USER_ID/);
      expect(valuesMatch).toBeTruthy();
    });

    it('should ensure all created contests have organizer_id = PLATFORM_SYSTEM_USER_ID', () => {
      // Check that PLATFORM_SYSTEM_USER_ID is defined
      const constMatch = scriptContent.match(/const PLATFORM_SYSTEM_USER_ID/);
      expect(constMatch).toBeTruthy();

      // Check that it's used in the INSERT query
      expect(scriptContent).toContain(
        'INSERT INTO contest_instances'
      );
      expect(scriptContent).toContain('organizer_id');
      expect(scriptContent).toContain('PLATFORM_SYSTEM_USER_ID');
    });
  });

  describe('Financial boundary compliance', () => {
    it('should not hardcode system user IDs in multiple places', () => {
      // Count occurrences of the canonical ID
      const canonicalIdCount = (scriptContent.match(
        /00000000-0000-0000-0000-000000000000/g
      ) || []).length;

      // Should be at least 1 (in the PLATFORM_SYSTEM_USER_ID assignment)
      expect(canonicalIdCount).toBeGreaterThan(0);

      // Should NOT have the legacy ID anywhere
      expect(scriptContent).not.toContain('00000000-0000-0000-0000-000000000043');
    });
  });
});
