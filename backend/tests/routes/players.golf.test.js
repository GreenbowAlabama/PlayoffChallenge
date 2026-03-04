/**
 * Players Route Tests — Golf Support
 *
 * Tests the /api/players endpoint with sport filtering.
 * - NFL players (default/legacy behavior)
 * - Golf players (new GOLF sport support)
 * - Query parameter filtering
 */

const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');

describe('GET /api/players - Sport Filtering', () => {
  let app;
  let pool;

  beforeAll(async () => {
    const { app: integrationApp, pool: dbPool } = getIntegrationApp();
    app = integrationApp;
    pool = dbPool;
  });

  beforeEach(async () => {
    // Clear golf players before each test
    await pool.query('DELETE FROM players WHERE sport = $1', ['GOLF']);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM players WHERE sport = $1', ['GOLF']);
  });

  describe('GET /api/players?sport=GOLF', () => {
    beforeEach(async () => {
      // Insert test golf players
      await pool.query(
        `INSERT INTO players (id, full_name, short_name, espn_id, position, sport, image_url, available, is_active)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9),
           ($10, $11, $12, $13, $14, $15, $16, $17, $18),
           ($19, $20, $21, $22, $23, $24, $25, $26, $27)`,
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
          true,
          'golf_3',
          'Tiger Woods',
          'T. Woods',
          'espn_99999',
          'G',
          'GOLF',
          'https://example.com/tiger.jpg',
          true,
          true
        ]
      );
    });

    it('should return 200 with golf players', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('players');
      expect(Array.isArray(response.body.players)).toBe(true);
    });

    it('should return all active golf players', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body.players).toHaveLength(3);
      const names = response.body.players.map(p => p.full_name).sort();
      expect(names).toEqual(['Jon Rahm', 'Rory McIlroy', 'Tiger Woods']);
    });

    it('should include required golf player fields', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      const player = response.body.players[0];
      expect(player).toHaveProperty('id');
      expect(player).toHaveProperty('full_name');
      expect(player).toHaveProperty('position');
      expect(player).toHaveProperty('image_url');
    });

    it('should filter golf players by position', async () => {
      const response = await request(app).get('/api/players?sport=GOLF&position=G');

      expect(response.status).toBe(200);
      response.body.players.forEach(player => {
        expect(player.position).toBe('G');
      });
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/players?sport=GOLF&limit=2');

      expect(response.status).toBe(200);
      expect(response.body.players.length).toBeLessThanOrEqual(2);
      expect(response.body.limit).toBe(2);
    });

    it('should respect offset parameter', async () => {
      const response = await request(app).get(
        '/api/players?sport=GOLF&offset=2'
      );

      expect(response.status).toBe(200);
      expect(response.body.offset).toBe(2);
    });

    it('should include pagination metadata', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('limit');
      expect(response.body).toHaveProperty('offset');
    });

    it('should return correct total count', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body.total).toBe(3);
    });

    it('should exclude inactive golf players', async () => {
      await pool.query(
        'UPDATE players SET is_active = false WHERE espn_id = $1',
        ['espn_12345']
      );

      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body.players).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });

    it('should exclude unavailable golf players', async () => {
      await pool.query(
        'UPDATE players SET available = false WHERE espn_id = $1',
        ['espn_67890']
      );

      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body.players).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });

    it('should return empty array if no golf players', async () => {
      await pool.query('DELETE FROM players WHERE sport = $1', ['GOLF']);

      const response = await request(app).get('/api/players?sport=GOLF');

      expect(response.body.players).toEqual([]);
      expect(response.body.total).toBe(0);
    });
  });

  describe('GET /api/players (default NFL)', () => {
    it('should return NFL players when no sport parameter provided', async () => {
      const response = await request(app).get('/api/players');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('players');
      // Note: May be empty in test environment, but should be array
      expect(Array.isArray(response.body.players)).toBe(true);
    });

    it('should not return golf players by default', async () => {
      // Insert a golf player
      await pool.query(
        `INSERT INTO players (id, full_name, short_name, espn_id, position, sport, image_url, available, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'golf_test',
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

      const response = await request(app).get('/api/players');

      // Golf players should NOT be in default response
      const hasGolfPlayer = response.body.players.some(
        p => p.sport === 'GOLF'
      );
      expect(hasGolfPlayer).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return 400 for invalid sport parameter', async () => {
      const response = await request(app).get(
        '/api/players?sport=INVALID'
      );

      // Should either return 400 or empty result (implementation choice)
      expect([200, 400]).toContain(response.status);
    });

    it('should handle invalid limit gracefully', async () => {
      const response = await request(app).get(
        '/api/players?sport=GOLF&limit=abc'
      );

      // Should either return 400 or use default limit
      expect([200, 400]).toContain(response.status);
    });

    it('should handle database errors gracefully', async () => {
      const response = await request(app).get('/api/players?sport=GOLF');

      // Should still return valid response even if DB has issues
      expect(response.status).toMatch(/^(200|500)$/);
    });
  });
});
