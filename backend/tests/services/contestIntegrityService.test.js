/**
 * Contest Integrity Service Unit Tests
 *
 * Tests the single aggregated operational snapshot for contest integrity.
 * Verifies all 5 diagnostic panels are returned together.
 */

const contestIntegrityService = require('../../services/contestIntegrityService');

describe('Contest Integrity Service', () => {
  let pool;

  beforeEach(() => {
    pool = {
      query: jest.fn()
    };
  });

  describe('getContestIntegritySnapshot', () => {
    it('should return complete snapshot with all 5 diagnostic panels', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result).toHaveProperty('tier_integrity');
      expect(result).toHaveProperty('capacity_summary');
      expect(result).toHaveProperty('player_pool_status');
      expect(result).toHaveProperty('duplicate_contests');
      expect(result).toHaveProperty('tournament_timeline');
      expect(result).toHaveProperty('timestamp');
    });

    it('should return all panels as arrays', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(Array.isArray(result.tier_integrity)).toBe(true);
      expect(Array.isArray(result.capacity_summary)).toBe(true);
      expect(Array.isArray(result.player_pool_status)).toBe(true);
      expect(Array.isArray(result.duplicate_contests)).toBe(true);
      expect(Array.isArray(result.tournament_timeline)).toBe(true);
    });

    it('should return empty arrays for all panels when no data exists', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.tier_integrity).toEqual([]);
      expect(result.capacity_summary).toEqual([]);
      expect(result.player_pool_status).toEqual([]);
      expect(result.duplicate_contests).toEqual([]);
      expect(result.tournament_timeline).toEqual([]);
    });

    it('should execute all 5 queries in parallel', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(pool.query).toHaveBeenCalledTimes(5);
    });

    it('should aggregate tier integrity data', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { provider_event_id: 'pga_001', entry_fee_cents: 10000, contests: 1 },
            { provider_event_id: 'pga_001', entry_fee_cents: 25000, contests: 1 }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.tier_integrity).toHaveLength(2);
      expect(result.tier_integrity[0].provider_event_id).toBe('pga_001');
    });

    it('should aggregate capacity data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { provider_event_id: 'pga_001', contests: 2, total_capacity: 50 }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.capacity_summary).toHaveLength(1);
      expect(result.capacity_summary[0].total_capacity).toBe(50);
    });

    it('should aggregate player pool data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { provider_event_id: 'pga_001', entry_fee_cents: 10000, golfers: 156 }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.player_pool_status).toHaveLength(1);
      expect(result.player_pool_status[0].golfers).toBe(156);
    });

    it('should aggregate duplicate contests data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            { provider_event_id: 'pga_001', entry_fee_cents: 10000, duplicates: 2 }
          ]
        })
        .mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.duplicate_contests).toHaveLength(1);
      expect(result.duplicate_contests[0].duplicates).toBe(2);
    });

    it('should aggregate tournament timeline data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              contest_name: 'PGA 2026',
              entry_fee_cents: 10000,
              max_entries: 20,
              tournament_start_time: '2026-05-15T08:00:00Z',
              lock_time: '2026-05-15T07:30:00Z'
            }
          ]
        });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.tournament_timeline).toHaveLength(1);
      expect(result.tournament_timeline[0].contest_name).toBe('PGA 2026');
    });

    it('should include timestamp in response', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should aggregate full diverse dataset', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ provider_event_id: 'pga_001', entry_fee_cents: 10000, contests: 1 }] })
        .mockResolvedValueOnce({ rows: [{ provider_event_id: 'pga_001', contests: 1, total_capacity: 50 }] })
        .mockResolvedValueOnce({ rows: [{ provider_event_id: 'pga_001', entry_fee_cents: 10000, golfers: 156 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ contest_name: 'PGA 2026', entry_fee_cents: 10000, max_entries: 20, tournament_start_time: '2026-05-15T08:00:00Z', lock_time: '2026-05-15T07:30:00Z' }] });

      const result = await contestIntegrityService.getContestIntegritySnapshot(pool);

      expect(result.tier_integrity).toHaveLength(1);
      expect(result.capacity_summary).toHaveLength(1);
      expect(result.player_pool_status).toHaveLength(1);
      expect(result.duplicate_contests).toHaveLength(0);
      expect(result.tournament_timeline).toHaveLength(1);
      expect(result.timestamp).toBeDefined();
    });
  });
});
