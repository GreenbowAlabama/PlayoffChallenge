/**
 * ROOT CAUSE DIAGNOSIS TEST
 *
 * Purpose: Demonstrate the actual bug with minimal code.
 * Based on real ESPN scoreboard athlete structure from staging logs.
 */

const espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');

describe('ESPN PGA Player Normalization - Root Cause', () => {
  describe('The Bug: normalizeGolfer receives athlete instead of competitor', () => {
    it('DEMONSTRATES BUG: normalizeGolfer(athlete) returns null - ID is on competitor level', () => {
      // This is what normalizeGolfer currently receives (athlete only)
      const espnAthlete = {
        fullName: 'Daniel Berger',
        displayName: 'Daniel Berger',
        shortName: 'D. Berger',
        flag: {
          href: 'https://a.espncdn.com/media/nav/country/us.png',
          alt: 'United States'
        }
        // NO id field on athlete - this is the bug
      };

      const result = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      // Current behavior: returns null because no id field
      expect(result).toBeNull(); // Documents the bug
    });

    it('FIX TEST: normalizeGolfer should handle competitor object with ID at wrapper level', () => {
      // This is the REAL ESPN structure where ID is at competitor level
      const espnCompetitor = {
        id: '12345',           // ← PLAYER ID IS HERE
        position: 1,
        status: 'active',
        athlete: {
          displayName: 'Daniel Berger',
          fullName: 'Daniel Berger',
          shortName: 'D. Berger',
          flag: {
            href: 'https://a.espncdn.com/media/nav/country/us.png',
            alt: 'United States'
          }
        }
      };

      // After fix, normalizeGolfer will accept competitor object
      const result = espnPgaPlayerService.normalizeGolfer(espnCompetitor);

      // This test FAILS with current code (returns null)
      // After fix, should return:
      expect(result).not.toBeNull();
      expect(result).toEqual({
        external_id: '12345',
        name: 'Daniel Berger',
        image_url: null,
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('BACKWARD COMPAT: normalizeGolfer still handles athlete with id field (if it has one)', () => {
      // In case some responses DO have athlete.id
      const athleteWithId = {
        id: '67890',
        displayName: 'Jon Rahm',
        headshot: {
          href: 'https://a.espncdn.com/media/golf/players/jon-rahm.png'
        }
      };

      const result = espnPgaPlayerService.normalizeGolfer(athleteWithId);

      // Should still work for backward compatibility
      expect(result).not.toBeNull();
      expect(result.external_id).toBe('67890');
      expect(result.name).toBe('Jon Rahm');
    });
  });
});
