/**
 * ESPN PGA Player Service Tests
 *
 * Tests the service that fetches and normalizes golfers from ESPN.
 */

const espnPgaPlayerService = require('../../services/ingestion/espn/espnPgaPlayerService');

// Mock axios for ESPN API calls
jest.mock('axios');
const axios = require('axios');

describe('ESPN PGA Player Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchGolfers', () => {
    it('should fetch golfers from ESPN scoreboard and normalize them', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        external_id: '12345',
        name: 'Rory McIlroy',
        image_url: 'https://a.espncdn.com/media/golf/players/12345.jpg',
        sport: 'GOLF',
        position: 'G'
      });
      expect(result[1]).toEqual({
        external_id: '67890',
        name: 'Jon Rahm',
        image_url: 'https://a.espncdn.com/media/golf/players/67890.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle missing headshot gracefully', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: null
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(1);
      expect(result[0].image_url).toBeNull();
    });

    it('should call ESPN API with correct endpoint', async () => {
      const mockEspnResponse = {
        data: {
          events: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      await espnPgaPlayerService.fetchGolfers();

      expect(axios.get).toHaveBeenCalledWith(
        'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
        expect.any(Object)
      );
    });

    it('should throw on ESPN API error', async () => {
      axios.get.mockRejectedValue(new Error('API Error'));

      await expect(espnPgaPlayerService.fetchGolfers()).rejects.toThrow(
        'API Error'
      );
    });

    it('should return empty array when no competitors in response', async () => {
      const mockEspnResponse = {
        data: {
          events: []
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toEqual([]);
    });

    it('should extract competitors from multiple competitions', async () => {
      const mockEspnResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
            },
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
                        }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockEspnResponse);

      const result = await espnPgaPlayerService.fetchGolfers();

      expect(result).toHaveLength(2);
      expect(result[0].external_id).toBe('12345');
      expect(result[1].external_id).toBe('67890');
    });
  });

  describe('normalizeGolfer', () => {
    it('should normalize a single golfer athlete object', () => {
      const espnAthlete = {
        id: '12345',
        displayName: 'Tiger Woods',
        headshot: {
          href: 'https://example.com/tiger.jpg'
        }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '12345',
        name: 'Tiger Woods',
        image_url: 'https://example.com/tiger.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should handle null headshot', () => {
      const espnAthlete = {
        id: '99999',
        displayName: 'Unknown Golfer',
        headshot: null
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized.image_url).toBeNull();
      expect(normalized.external_id).toBe('99999');
    });

    it('should handle missing headshot field', () => {
      const espnAthlete = {
        id: '88888',
        displayName: 'Another Golfer'
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized.image_url).toBeNull();
      expect(normalized.external_id).toBe('88888');
    });
  });

  describe('fetchTournamentField', () => {
    it('should fetch golfers from ESPN leaderboard endpoint', async () => {
      const mockLeaderboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      },
                      startTime: '2026-03-12T07:00Z'
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/67890.jpg'
                        }
                      },
                      startTime: '2026-03-12T07:09Z'
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        external_id: '12345',
        name: 'Rory McIlroy',
        image_url: 'https://a.espncdn.com/media/golf/players/12345.jpg',
        sport: 'GOLF',
        position: 'G'
      });
      expect(result[1]).toEqual({
        external_id: '67890',
        name: 'Jon Rahm',
        image_url: 'https://a.espncdn.com/media/golf/players/67890.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should call ESPN leaderboard endpoint with correct event ID', async () => {
      const mockLeaderboardResponse = {
        data: {
          events: []
        }
      };

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(axios.get).toHaveBeenCalledWith(
        'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event=401811937',
        expect.any(Object)
      );
    });

    it('should handle missing headshot in leaderboard response', async () => {
      const mockLeaderboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Golfer with no photo',
                        headshot: null
                      },
                      startTime: '2026-03-12T07:00Z'
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toHaveLength(1);
      expect(result[0].image_url).toBeNull();
    });

    it('should throw on ESPN API error', async () => {
      axios.get.mockRejectedValue(new Error('API Error'));

      await expect(
        espnPgaPlayerService.fetchTournamentField('401811937')
      ).rejects.toThrow('API Error');
    });

    it('should return empty array when no competitors in leaderboard response', async () => {
      const mockLeaderboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: []
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toEqual([]);
    });

    it('should extract competitors from nested events and competitions', async () => {
      const mockLeaderboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '100',
                        displayName: 'Golfer A',
                        headshot: { href: 'https://example.com/a.jpg' }
                      },
                      startTime: '2026-03-12T07:00Z'
                    },
                    {
                      athlete: {
                        id: '200',
                        displayName: 'Golfer B',
                        headshot: { href: 'https://example.com/b.jpg' }
                      },
                      startTime: '2026-03-12T07:09Z'
                    },
                    {
                      athlete: {
                        id: '300',
                        displayName: 'Golfer C',
                        headshot: { href: 'https://example.com/c.jpg' }
                      },
                      startTime: '2026-03-12T07:18Z'
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toHaveLength(3);
      expect(result.map(g => g.external_id)).toEqual(['100', '200', '300']);
    });

    it('should require eventId parameter', async () => {
      await expect(
        espnPgaPlayerService.fetchTournamentField(null)
      ).rejects.toThrow();

      await expect(
        espnPgaPlayerService.fetchTournamentField(undefined)
      ).rejects.toThrow();
    });

    it('should fallback to scoreboard when leaderboard has no competitors', async () => {
      // Leaderboard returns empty competitors
      const emptyLeaderboard = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: []
                }
              ]
            }
          ]
        }
      };

      // Scoreboard returns full field
      const scoreboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/12345.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/67890.jpg' }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      // Mock axios to return empty leaderboard first, then scoreboard
      axios.get
        .mockResolvedValueOnce(emptyLeaderboard)
        .mockResolvedValueOnce(scoreboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Rory McIlroy');
      expect(result[1].name).toBe('Jon Rahm');

      // Verify both endpoints were called
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(axios.get).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('leaderboard'),
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('scoreboard'),
        expect.any(Object)
      );
    });

    it('should use leaderboard when it has competitors (no fallback)', async () => {
      const leaderboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/12345.jpg' }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get.mockResolvedValueOnce(leaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Rory McIlroy');

      // Verify only leaderboard was called (no fallback)
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('leaderboard'),
        expect.any(Object)
      );
    });

    it('should throw if both leaderboard and scoreboard fail', async () => {
      axios.get
        .mockRejectedValueOnce(new Error('Leaderboard API Error'))
        .mockRejectedValueOnce(new Error('Scoreboard API Error'));

      await expect(
        espnPgaPlayerService.fetchTournamentField('401811937')
      ).rejects.toThrow('Scoreboard API Error');
    });

    it('should deduplicate competitors across events when using scoreboard fallback', async () => {
      // Leaderboard empty
      const emptyLeaderboard = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: []
                }
              ]
            }
          ]
        }
      };

      // Scoreboard with same golfer in multiple events (shouldn't happen, but test it)
      const scoreboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/12345.jpg' }
                      }
                    }
                  ]
                }
              ]
            },
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Jon Rahm',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/67890.jpg' }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get
        .mockResolvedValueOnce(emptyLeaderboard)
        .mockResolvedValueOnce(scoreboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      // Should have 2 unique golfers from 2 events
      expect(result).toHaveLength(2);
      expect(result.map(g => g.external_id)).toEqual(['12345', '67890']);
    });

    it('should log when falling back to scoreboard', async () => {
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

      const emptyLeaderboard = {
        data: {
          events: [{ competitions: [{ competitors: [] }] }]
        }
      };

      const scoreboardResponse = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Rory McIlroy',
                        headshot: { href: 'https://example.com/rory.jpg' }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      };

      axios.get
        .mockResolvedValueOnce(emptyLeaderboard)
        .mockResolvedValueOnce(scoreboardResponse);

      await espnPgaPlayerService.fetchTournamentField('401811937');

      // Verify fallback was logged
      const fallbackCalls = consoleInfoSpy.mock.calls.filter(call =>
        String(call[0]).includes('fallback') || String(call[0]).includes('empty')
      );
      expect(fallbackCalls.length).toBeGreaterThan(0);

      consoleInfoSpy.mockRestore();
    });
  });
});
