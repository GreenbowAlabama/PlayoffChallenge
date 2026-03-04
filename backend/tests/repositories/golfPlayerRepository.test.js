/**
 * Golf Player Repository Tests
 *
 * Tests that golfers are correctly upserted and retrieved from the database.
 */

const golfPlayerRepository = require('../../repositories/golfPlayerRepository');
const { getPoolForTest } = require('../mocks/testAppFactory');

describe('Golf Player Repository', () => {
  let pool;

  beforeAll(async () => {
    pool = getPoolForTest();
  });

  beforeEach(async () => {
    // Clear golf players before each test (keep other sports)
    await pool.query('DELETE FROM players WHERE sport = $1', ['GOLF']);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM players WHERE sport = $1', ['GOLF']);
  });

  describe('upsertGolfPlayers', () => {
    it('should insert new golf players', async () => {
      const golfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        },
        {
          external_id: 'espn_67890',
          name: 'Jon Rahm',
          short_name: 'J. Rahm',
          image_url: 'https://example.com/jon.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      const result = await golfPlayerRepository.upsertGolfPlayers(pool, golfers);

      expect(result).toEqual({
        inserted: 2,
        updated: 0
      });

      // Verify they're in the database
      const query = await pool.query(
        'SELECT * FROM players WHERE sport = $1 ORDER BY full_name',
        ['GOLF']
      );

      expect(query.rows).toHaveLength(2);
      expect(query.rows[0].full_name).toBe('Jon Rahm');
      expect(query.rows[0].espn_id).toBe('espn_67890');
      expect(query.rows[1].full_name).toBe('Rory McIlroy');
    });

    it('should update existing golf players by external_id', async () => {
      // Insert initial player
      await pool.query(
        `INSERT INTO players (id, full_name, short_name, espn_id, position, sport, image_url, available, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'golf_player_1',
          'Rory McIlroy',
          'R. McIlroy',
          'espn_12345',
          'G',
          'GOLF',
          'https://example.com/rory_old.jpg',
          true,
          true
        ]
      );

      // Upsert with updated image_url
      const golfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory_new.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      const result = await golfPlayerRepository.upsertGolfPlayers(pool, golfers);

      expect(result).toEqual({
        inserted: 0,
        updated: 1
      });

      // Verify image_url was updated
      const query = await pool.query(
        'SELECT image_url FROM players WHERE espn_id = $1',
        ['espn_12345']
      );

      expect(query.rows[0].image_url).toBe('https://example.com/rory_new.jpg');
    });

    it('should handle mixed insert and update', async () => {
      // Insert one existing player
      await pool.query(
        `INSERT INTO players (id, full_name, short_name, espn_id, position, sport, image_url, available, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'golf_player_1',
          'Rory McIlroy',
          'R. McIlroy',
          'espn_12345',
          'G',
          'GOLF',
          'https://example.com/rory.jpg',
          true,
          true
        ]
      );

      // Upsert with one update and one new insert
      const golfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory_updated.jpg',
          sport: 'GOLF',
          position: 'G'
        },
        {
          external_id: 'espn_99999',
          name: 'Tiger Woods',
          short_name: 'T. Woods',
          image_url: 'https://example.com/tiger.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      const result = await golfPlayerRepository.upsertGolfPlayers(pool, golfers);

      expect(result).toEqual({
        inserted: 1,
        updated: 1
      });

      // Verify count
      const query = await pool.query(
        'SELECT COUNT(*) as count FROM players WHERE sport = $1',
        ['GOLF']
      );

      expect(parseInt(query.rows[0].count)).toBe(2);
    });

    it('should set available and is_active to true', async () => {
      const golfers = [
        {
          external_id: 'espn_12345',
          name: 'Rory McIlroy',
          short_name: 'R. McIlroy',
          image_url: 'https://example.com/rory.jpg',
          sport: 'GOLF',
          position: 'G'
        }
      ];

      await golfPlayerRepository.upsertGolfPlayers(pool, golfers);

      const query = await pool.query(
        'SELECT available, is_active FROM players WHERE sport = $1',
        ['GOLF']
      );

      expect(query.rows[0].available).toBe(true);
      expect(query.rows[0].is_active).toBe(true);
    });

    it('should handle empty golfer list', async () => {
      const result = await golfPlayerRepository.upsertGolfPlayers(pool, []);

      expect(result).toEqual({
        inserted: 0,
        updated: 0
      });
    });
  });

  describe('getGolfPlayersBySport', () => {
    beforeEach(async () => {
      // Insert test golf players
      await pool.query(
        `INSERT INTO players (id, full_name, short_name, espn_id, position, sport, image_url, available, is_active)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9),
           ($10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          'golf_1',
          'Rory McIlroy',
          'R. McIlroy',
          'espn_12345',
          'G',
          'GOLF',
          'https://example.com/rory.jpg',
          true,
          true,
          'golf_2',
          'Jon Rahm',
          'J. Rahm',
          'espn_67890',
          'G',
          'GOLF',
          'https://example.com/jon.jpg',
          true,
          true
        ]
      );
    });

    it('should retrieve all active available golf players', async () => {
      const players = await golfPlayerRepository.getGolfPlayersBySport(pool);

      expect(players).toHaveLength(2);
      expect(players.map(p => p.full_name).sort()).toEqual([
        'Jon Rahm',
        'Rory McIlroy'
      ]);
    });

    it('should not return inactive players', async () => {
      await pool.query(
        'UPDATE players SET is_active = false WHERE espn_id = $1',
        ['espn_12345']
      );

      const players = await golfPlayerRepository.getGolfPlayersBySport(pool);

      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Jon Rahm');
    });

    it('should not return unavailable players', async () => {
      await pool.query(
        'UPDATE players SET available = false WHERE espn_id = $1',
        ['espn_67890']
      );

      const players = await golfPlayerRepository.getGolfPlayersBySport(pool);

      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Rory McIlroy');
    });

    it('should respect limit and offset', async () => {
      const players = await golfPlayerRepository.getGolfPlayersBySport(
        pool,
        { limit: 1, offset: 0 }
      );

      expect(players).toHaveLength(1);
    });

    it('should return paginated results', async () => {
      const page1 = await golfPlayerRepository.getGolfPlayersBySport(
        pool,
        { limit: 1, offset: 0 }
      );
      const page2 = await golfPlayerRepository.getGolfPlayersBySport(
        pool,
        { limit: 1, offset: 1 }
      );

      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });
});
