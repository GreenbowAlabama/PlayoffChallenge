/**
 * Unit tests for PGA ESPN Event Selection (Batch 2.1)
 *
 * Tests the 6-tier deterministic event selection algorithm:
 * 1. Config override
 * 2. Date window overlap
 * 3. Exact name match
 * 4. Substring match
 * 5. Tie-breakers
 * 6. Escalation
 *
 * Plus year validation (MANDATORY, enforced upfront).
 */

'use strict';

const {
  selectEventIdForContest,
  validateEspnLeaderboardShape
} = require('../../services/ingestion/orchestrators/pgaEspnPollingOrchestrator');

describe('selectEventIdForContest', () => {
  // ─── Test Fixtures ─────────────────────────────────────────────────────
  const calendar2026 = {
    events: [
      {
        id: '401811941',
        label: 'Masters Tournament',
        startDate: '2026-04-09T07:00Z',
        endDate: '2026-04-12T07:00Z'
      },
      {
        id: '401823456',
        label: 'PGA Championship',
        startDate: '2026-05-21T07:00Z',
        endDate: '2026-05-24T07:00Z'
      },
      {
        id: '401834567',
        label: 'U.S. Open Championship',
        startDate: '2026-06-18T07:00Z',
        endDate: '2026-06-21T07:00Z'
      }
    ]
  };

  const calendarMixed = {
    events: [
      {
        id: '401811941',
        label: 'Masters Tournament',
        startDate: '2026-04-09T07:00Z',
        endDate: '2026-04-12T07:00Z'
      },
      {
        id: '401822000',
        label: 'Masters Tournament',
        startDate: '2027-04-09T07:00Z',
        endDate: '2027-04-12T07:00Z'
      }
    ]
  };

  // ─── Tier 1: Config Override ──────────────────────────────────────────

  describe('Tier 1: Config Override', () => {
    it('returns config.event_id if present and valid', () => {
      const contest = {
        id: 'test-1',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-09',
        end_date: '2026-04-12',
        config: { event_id: '401811941' }
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBe('401811941');
    });

    it('returns null if config.event_id not found in calendar', () => {
      const contest = {
        id: 'test-2',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: { event_id: '999999999' }
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });

    it('returns null if config.event_id is in wrong year', () => {
      const contest = {
        id: 'test-3',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: { event_id: '401822000' } // This is 2027
      };
      const result = selectEventIdForContest(contest, calendarMixed);
      expect(result).toBeNull();
    });
  });

  // ─── Tier 2: Date Window Overlap ──────────────────────────────────────

  describe('Tier 2: Date Window Overlap', () => {
    it('selects unique date-overlap match', () => {
      const contest = {
        id: 'test-4',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-09',
        end_date: '2026-04-12',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBe('401811941');
    });

    it('falls back to name matching if no date overlap', () => {
      const contest = {
        id: 'test-5',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-08-01',
        end_date: '2026-08-05',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      // Date window doesn't match, but name match should work
      expect(result).toBe('401811941');
    });

    it('continues to name matching if multiple date overlaps', () => {
      const multiCalendar = {
        events: [
          {
            id: '1',
            label: 'Tournament A',
            startDate: '2026-04-09T07:00Z',
            endDate: '2026-04-12T07:00Z'
          },
          {
            id: '2',
            label: 'Masters Tournament',
            startDate: '2026-04-10T07:00Z',
            endDate: '2026-04-11T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-6',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-09',
        end_date: '2026-04-12',
        config: {}
      };
      const result = selectEventIdForContest(contest, multiCalendar);
      // Both overlap, but name match should select the exact one
      expect(result).toBe('2');
    });
  });

  // ─── Tier 3: Exact Name Match ──────────────────────────────────────────

  describe('Tier 3: Exact Normalized Name Match', () => {
    it('exact matches normalized name (case insensitive)', () => {
      const contest = {
        id: 'test-7',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'MASTERS TOURNAMENT',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBe('401811941');
    });

    it('exact matches after punctuation removal', () => {
      const contest = {
        id: 'test-8',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: "Masters' Tournament",
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBe('401811941');
    });

    it('returns null if exact name has no match and no date overlap', () => {
      const contest = {
        id: 'test-9',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Nonexistent Event',
        // No date window — will try name matching only
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });
  });

  // ─── Tier 4: Substring Match ────────────────────────────────────────────

  describe('Tier 4: Substring Match', () => {
    it('matches substring (contest name in ESPN label)', () => {
      const contest = {
        id: 'test-10',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBe('401811941');
    });

    it('matches substring (partial word)', () => {
      const contest = {
        id: 'test-11',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Championship',
        start_date: '2026-06-01',
        end_date: '2026-06-30',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      // Two matches: PGA Championship and U.S. Open Championship
      // Will proceed to tie-breakers
      expect(result).not.toBeNull();
    });

    it('returns null if substring has no match and no date overlap', () => {
      const contest = {
        id: 'test-12',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'XYZ Tournament',
        // No date window — will try name matching only
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });
  });

  // ─── Tier 5: Deterministic Tie-Breakers ────────────────────────────────

  describe('Tier 5: Deterministic Tie-Breakers', () => {
    it('prefers exact match over substring when both exist', () => {
      const tieCalendar = {
        events: [
          {
            id: '1',
            label: 'Masters',
            startDate: '2026-04-09T07:00Z',
            endDate: '2026-04-12T07:00Z'
          },
          {
            id: '2',
            label: 'Masters Tournament',
            startDate: '2026-04-09T07:00Z',
            endDate: '2026-04-12T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-13',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, tieCalendar);
      expect(result).toBe('1'); // Exact match preferred
    });

    it('tie-break: closest date wins', () => {
      const tieCalendar = {
        events: [
          {
            id: '1',
            label: 'Masters',
            startDate: '2026-04-09T07:00Z'
          },
          {
            id: '2',
            label: 'Masters',
            startDate: '2026-04-15T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-14',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-09',
        config: {}
      };
      const result = selectEventIdForContest(contest, tieCalendar);
      expect(result).toBe('1'); // Closer to expected date
    });

    it('tie-break: earlier date wins when same distance', () => {
      const tieCalendar = {
        events: [
          {
            id: '1',
            label: 'Masters',
            startDate: '2026-04-05T07:00Z'
          },
          {
            id: '2',
            label: 'Masters',
            startDate: '2026-04-13T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-15',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-09',
        config: {}
      };
      const result = selectEventIdForContest(contest, tieCalendar);
      expect(result).toBe('1'); // Earlier date wins
    });

    it('tie-break: lowest numeric ID wins as final fallback', () => {
      const tieCalendar = {
        events: [
          {
            id: '401811942',
            label: 'Masters',
            startDate: '2026-04-09T07:00Z'
          },
          {
            id: '401811941',
            label: 'Masters',
            startDate: '2026-04-09T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-16',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, tieCalendar);
      expect(result).toBe('401811941'); // Lowest ID
    });

    it('skips closest-date rule if no start_date provided', () => {
      const tieCalendar = {
        events: [
          {
            id: '1',
            label: 'Masters',
            startDate: '2026-04-05T07:00Z'
          },
          {
            id: '2',
            label: 'Masters',
            startDate: '2026-04-15T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-17',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        // No start_date
        config: {}
      };
      const result = selectEventIdForContest(contest, tieCalendar);
      expect(result).toBe('1'); // Earlier date still wins
    });
  });

  // ─── Year Validation (MANDATORY) ────────────────────────────────────────

  describe('Year Validation (MANDATORY)', () => {
    it('filters calendar to only events matching contest.season_year upfront', () => {
      const contest = {
        id: 'test-18',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendarMixed);
      expect(result).toBe('401811941'); // 2026, not 2027
    });

    it('returns null if no events match season_year', () => {
      const contest = {
        id: 'test-19',
        provider_league_id: 1106,
        season_year: 2025,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });

    it('rejects config.event_id if year mismatch', () => {
      const contest = {
        id: 'test-20',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: { event_id: '401822000' } // 2027
      };
      const result = selectEventIdForContest(contest, calendarMixed);
      expect(result).toBeNull();
    });
  });

  // ─── Determinism & Repeatability ──────────────────────────────────────

  describe('Determinism & Repeatability', () => {
    it('returns same ID on repeated calls (determinism)', () => {
      const contest = {
        id: 'test-21',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        config: {}
      };
      const result1 = selectEventIdForContest(contest, calendar2026);
      const result2 = selectEventIdForContest(contest, calendar2026);
      expect(result1).toBe(result2);
      expect(result1).toBe('401811941');
    });

    it('not affected by calendar event order (determinism)', () => {
      const reverseCalendar = {
        events: [...calendar2026.events].reverse()
      };
      const contest = {
        id: 'test-22',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        config: {}
      };
      const result1 = selectEventIdForContest(contest, calendar2026);
      const result2 = selectEventIdForContest(contest, reverseCalendar);
      expect(result1).toBe(result2);
    });

    it('not affected by multiple calendar shuffles (determinism)', () => {
      const contest = {
        id: 'test-23',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'PGA Championship',
        config: {}
      };
      const results = [1, 2, 3].map(() => {
        const shuffled = {
          events: [...calendar2026.events].sort(() => Math.random() - 0.5)
        };
        return selectEventIdForContest(contest, shuffled);
      });
      expect(results[0]).toBe('401823456');
      expect(results[1]).toBe('401823456');
      expect(results[2]).toBe('401823456');
    });
  });

  // ─── Error Cases & Edge Cases ──────────────────────────────────────────

  describe('Error Cases & Edge Cases', () => {
    it('returns null if missing provider_league_id', () => {
      const contest = {
        id: 'test-24',
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });

    it('returns null if missing season_year', () => {
      const contest = {
        id: 'test-25',
        provider_league_id: 1106,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });

    it('returns null if calendar is null', () => {
      const contest = {
        id: 'test-26',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, null);
      expect(result).toBeNull();
    });

    it('returns null if calendar has no events', () => {
      const contest = {
        id: 'test-27',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, { events: [] });
      expect(result).toBeNull();
    });

    it('returns null if event_name missing and no date window', () => {
      const contest = {
        id: 'test-28',
        provider_league_id: 1106,
        season_year: 2026,
        config: {}
        // No event_name, no start_date/end_date
      };
      const result = selectEventIdForContest(contest, calendar2026);
      expect(result).toBeNull();
    });

    it('handles invalid date strings gracefully', () => {
      const badCalendar = {
        events: [
          {
            id: '1',
            label: 'Event A',
            startDate: 'not-a-date',
            endDate: 'also-not-a-date'
          },
          {
            id: '401811941',
            label: 'Masters Tournament',
            startDate: '2026-04-09T07:00Z',
            endDate: '2026-04-12T07:00Z'
          }
        ]
      };
      const contest = {
        id: 'test-29',
        provider_league_id: 1106,
        season_year: 2026,
        event_name: 'Masters',
        config: {}
      };
      const result = selectEventIdForContest(contest, badCalendar);
      expect(result).toBe('401811941'); // Should skip invalid and find valid
    });
  });
});

// ─── validateEspnLeaderboardShape Tests ────────────────────────────────

describe('validateEspnLeaderboardShape', () => {
  describe('Valid payloads', () => {
    it('accepts valid minimal leaderboard', () => {
      const payload = {
        events: [
          {
            competitions: [
              {
                competitors: [
                  { id: 'athlete1', linescores: [] }
                ]
              }
            ]
          }
        ]
      };
      const result = validateEspnLeaderboardShape(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Invalid payloads', () => {
    it('rejects null payload', () => {
      const result = validateEspnLeaderboardShape(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('null or not an object');
    });

    it('rejects missing events array', () => {
      const result = validateEspnLeaderboardShape({});
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('events array missing');
    });

    it('rejects empty events array', () => {
      const result = validateEspnLeaderboardShape({ events: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('events array missing');
    });

    it('rejects events[0] = null', () => {
      const result = validateEspnLeaderboardShape({ events: [null] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('events[0] is null');
    });

    it('rejects missing competitions array', () => {
      const result = validateEspnLeaderboardShape({
        events: [{}]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('competitions array missing');
    });

    it('rejects empty competitions array', () => {
      const result = validateEspnLeaderboardShape({
        events: [{ competitions: [] }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('competitions array missing');
    });

    it('rejects competitions[0] = null', () => {
      const result = validateEspnLeaderboardShape({
        events: [{ competitions: [null] }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('competitions[0] is null');
    });

    it('rejects missing competitors array', () => {
      const result = validateEspnLeaderboardShape({
        events: [{ competitions: [{}] }]
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('competitors array missing');
    });
  });
});
