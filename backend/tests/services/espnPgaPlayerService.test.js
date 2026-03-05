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
                      id: '12345',
                      athlete: {
                        displayName: 'Rory McIlroy',
                        headshot: {
                          href: 'https://a.espncdn.com/media/golf/players/12345.jpg'
                        }
                      }
                    },
                    {
                      id: '67890',
                      athlete: {
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
                      id: '12345',
                      athlete: {
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

    it('should filter out golfers with missing athlete.id', async () => {
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
                        displayName: 'Valid Golfer',
                        headshot: { href: 'https://example.com/valid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        // Missing id
                        displayName: 'Missing ID Golfer',
                        headshot: { href: 'https://example.com/invalid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Another Valid',
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

      // Should only include golfers with valid id
      expect(result).toHaveLength(2);
      expect(result.map(g => g.external_id)).toEqual(['12345', '67890']);
    });

    it('should filter out golfers with missing athlete.displayName', async () => {
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
                        displayName: 'Valid Golfer',
                        headshot: { href: 'https://example.com/valid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '99999',
                        // Missing displayName
                        headshot: { href: 'https://example.com/invalid.jpg' }
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

      // Should only include golfers with valid displayName
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Valid Golfer');
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

    it('should return null if athlete.id is missing', () => {
      const espnAthlete = {
        displayName: 'Missing ID Golfer',
        headshot: { href: 'https://example.com/golfer.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should return null if athlete.id is null', () => {
      const espnAthlete = {
        id: null,
        displayName: 'Null ID Golfer',
        headshot: { href: 'https://example.com/golfer.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should return null if athlete.displayName is missing', () => {
      const espnAthlete = {
        id: '12345',
        headshot: { href: 'https://example.com/golfer.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should return null if athlete.displayName is null', () => {
      const espnAthlete = {
        id: '12345',
        displayName: null,
        headshot: { href: 'https://example.com/golfer.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should return null if athlete.displayName is empty string', () => {
      const espnAthlete = {
        id: '12345',
        displayName: '',
        headshot: { href: 'https://example.com/golfer.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should construct displayName from firstName and lastName if displayName missing', () => {
      const espnAthlete = {
        id: '12345',
        firstName: 'Rory',
        lastName: 'McIlroy',
        headshot: { href: 'https://example.com/rory.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '12345',
        name: 'Rory McIlroy',
        image_url: 'https://example.com/rory.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should use firstName alone if lastName missing', () => {
      const espnAthlete = {
        id: '12345',
        firstName: 'Tiger',
        headshot: { href: 'https://example.com/tiger.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '12345',
        name: 'Tiger',
        image_url: 'https://example.com/tiger.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should accept athleteId as alternative to id', () => {
      const espnAthlete = {
        athleteId: '99999',
        displayName: 'Test Golfer',
        headshot: { href: 'https://example.com/test.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toEqual({
        external_id: '99999',
        name: 'Test Golfer',
        image_url: 'https://example.com/test.jpg',
        sport: 'GOLF',
        position: 'G'
      });
    });

    it('should require either id or athleteId', () => {
      const espnAthlete = {
        displayName: 'No ID Golfer',
        headshot: { href: 'https://example.com/noid.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
    });

    it('should require some form of name (displayName or firstName)', () => {
      const espnAthlete = {
        id: '12345',
        headshot: { href: 'https://example.com/noname.jpg' }
      };

      const normalized = espnPgaPlayerService.normalizeGolfer(espnAthlete);

      expect(normalized).toBeNull();
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

      // Scoreboard returns full field with matching event ID
      const scoreboardResponse = {
        data: {
          events: [
            {
              id: '401811937',  // Must match requested event ID
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

    it('should extract competitors only from requested event in scoreboard', async () => {
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

      // Scoreboard with multiple events - request only one
      const scoreboardResponse = {
        data: {
          events: [
            {
              id: '401811935',  // Different event
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '11111',
                        displayName: 'Other Golfer',
                        headshot: { href: 'https://a.espncdn.com/media/golf/players/11111.jpg' }
                      }
                    }
                  ]
                }
              ]
            },
            {
              id: '401811937',  // Requested event
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

      axios.get
        .mockResolvedValueOnce(emptyLeaderboard)
        .mockResolvedValueOnce(scoreboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      // Should return only golfers from event 401811937, not from 401811935
      expect(result).toHaveLength(2);
      expect(result.map(g => g.external_id)).toEqual(['12345', '67890']);
      expect(result.map(g => g.name)).toEqual(['Rory McIlroy', 'Jon Rahm']);
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

    it('should filter out competitors with missing athlete.id in leaderboard', async () => {
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
                        displayName: 'Valid Golfer',
                        headshot: { href: 'https://example.com/valid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        // Missing id
                        displayName: 'Missing ID Golfer',
                        headshot: { href: 'https://example.com/invalid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Another Valid',
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

      axios.get.mockResolvedValue(mockLeaderboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      // Should only include golfers with valid id and displayName
      expect(result).toHaveLength(2);
      expect(result.map(g => g.external_id)).toEqual(['12345', '67890']);
    });

    it('should filter out competitors with missing athlete.displayName in scoreboard fallback', async () => {
      // Leaderboard is empty (forces fallback)
      const emptyLeaderboard = {
        data: {
          events: [{ competitions: [{ competitors: [] }] }]
        }
      };

      // Scoreboard with some invalid competitors
      const scoreboardResponse = {
        data: {
          events: [
            {
              id: '401811937',
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: '12345',
                        displayName: 'Valid Golfer',
                        headshot: { href: 'https://example.com/valid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '99999',
                        // Missing displayName
                        headshot: { href: 'https://example.com/invalid.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: '67890',
                        displayName: 'Another Valid',
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

      axios.get
        .mockResolvedValueOnce(emptyLeaderboard)
        .mockResolvedValueOnce(scoreboardResponse);

      const result = await espnPgaPlayerService.fetchTournamentField('401811937');

      // Should only include golfers with both id and displayName
      expect(result).toHaveLength(2);
      expect(result.map(g => g.name)).toEqual(['Valid Golfer', 'Another Valid']);
    });

    it('BLOCKER #2: should filter scoreboard by eventId (not return all events)', async () => {
      const requestedEventId = '401811937';

      // Leaderboard is empty (forces fallback to scoreboard)
      const emptyLeaderboard = {
        data: {
          events: [
            {
              competitions: [
                {
                  competitors: []  // Empty - forces fallback
                }
              ]
            }
          ]
        }
      };

      // Scoreboard contains 3 events with different golfers
      const scoreboardResponse = {
        data: {
          events: [
            {
              id: '401811935',
              name: 'Arnold Palmer Invitational',
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: 'player1',
                        displayName: 'Player One',
                        headshot: { href: 'https://example.com/p1.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: 'player2',
                        displayName: 'Player Two',
                        headshot: { href: 'https://example.com/p2.jpg' }
                      }
                    }
                  ]
                }
              ]
            },
            {
              id: '401811937',
              name: 'The Masters',
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: 'player3',
                        displayName: 'Player Three',
                        headshot: { href: 'https://example.com/p3.jpg' }
                      }
                    },
                    {
                      athlete: {
                        id: 'player4',
                        displayName: 'Player Four',
                        headshot: { href: 'https://example.com/p4.jpg' }
                      }
                    }
                  ]
                }
              ]
            },
            {
              id: '401811939',
              name: 'PGA Championship',
              competitions: [
                {
                  competitors: [
                    {
                      athlete: {
                        id: 'player5',
                        displayName: 'Player Five',
                        headshot: { href: 'https://example.com/p5.jpg' }
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

      // Request only event 401811937
      const result = await espnPgaPlayerService.fetchTournamentField(requestedEventId);

      const playerIds = result.map(g => g.external_id);
      const playerNames = result.map(g => g.name);

      // CRITICAL ASSERTION: Should return ONLY golfers from requested event
      // If BLOCKER #2 bug exists, would return all 5 golfers from all 3 events
      expect(playerIds).toContain('player3');  // From event 401811937
      expect(playerIds).toContain('player4');  // From event 401811937

      // Should NOT include golfers from other events
      expect(playerIds).not.toContain('player1');  // From event 401811935
      expect(playerIds).not.toContain('player2');  // From event 401811935
      expect(playerIds).not.toContain('player5');  // From event 401811939

      // Verify exact count: only 2 golfers from requested event
      expect(result).toHaveLength(2);

      // Verify player names
      expect(playerNames).toContain('Player Three');
      expect(playerNames).toContain('Player Four');
    });
  });
});
