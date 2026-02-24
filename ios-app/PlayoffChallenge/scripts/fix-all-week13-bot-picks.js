#!/usr/bin/env node
/**
 * Fix all Week 13 bot picks to ensure each has exactly:
 * 1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 DEF (all with 2x multiplier)
 */
const https = require('https');

const API_BASE = 'https://playoffchallenge-production.up.railway.app';

const POSITION_REQUIREMENTS = {
  'QB': 1,
  'RB': 2,
  'WR': 2,
  'TE': 1,
  'K': 1,
  'DEF': 1
};

async function apiRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function fixWeek13BotPicks() {
  try {
    console.log('Fixing Week 13 bot picks to ensure proper position counts...\n');

    // Get leaderboard with picks
    const leaderboard = await apiRequest('GET', '/api/leaderboard?weekNumber=13&includePicks=true');
    const bots = leaderboard.filter(u => u.email && u.email.includes('@test.com'));
    console.log(`Found ${bots.length} bot accounts\n`);

    // Get players by position (use API filter to avoid cache limit issues)
    const playersByPosition = {};
    for (const pos of Object.keys(POSITION_REQUIREMENTS)) {
      const posResponse = await apiRequest('GET', `/api/players?position=${pos}&limit=500`);
      playersByPosition[pos] = posResponse.players || [];
      console.log(`Available ${pos} players: ${playersByPosition[pos].length}`);
    }
    console.log('');

    let fixedCount = 0;

    for (const bot of bots) {
      const picks = bot.picks || [];

      // Count current picks by position
      const currentCounts = {};
      const existingPlayerIds = new Set();

      for (const pick of picks) {
        const pos = pick.position || 'UNKNOWN';
        currentCounts[pos] = (currentCounts[pos] || 0) + 1;
        if (pick.player_id) {
          existingPlayerIds.add(pick.player_id);
        }
      }

      // Determine what's missing
      const missing = [];
      for (const [pos, required] of Object.entries(POSITION_REQUIREMENTS)) {
        const current = currentCounts[pos] || 0;
        const needed = required - current;

        if (needed > 0) {
          for (let i = 0; i < needed; i++) {
            missing.push(pos);
          }
        }
      }

      if (missing.length === 0) {
        console.log(`✓ ${bot.name}: Complete (${picks.length} picks)`);
        continue;
      }

      console.log(`${bot.name}: Missing ${missing.join(', ')}`);

      // Add missing picks
      for (const pos of missing) {
        const available = playersByPosition[pos].filter(p => !existingPlayerIds.has(p.id));

        if (available.length === 0) {
          if (playersByPosition[pos].length === 0) {
            console.log(`  ERROR: No ${pos} players exist at all! Skipping...`);
            continue;
          }
          console.log(`  WARNING: No available ${pos} players, using random one`);
          const randomPlayer = playersByPosition[pos][Math.floor(Math.random() * playersByPosition[pos].length)];
          available.push(randomPlayer);
        }

        const player = available[Math.floor(Math.random() * available.length)];

        if (!player || !player.id) {
          console.log(`  ERROR: Invalid player object for ${pos}. Skipping...`);
          continue;
        }

        const pickData = {
          userId: bot.id,
          playerId: player.id,
          weekNumber: 13,
          multiplier: 2
        };

        try {
          await apiRequest('POST', '/api/picks', pickData);
          console.log(`  Added ${pos}: ${player.first_name} ${player.last_name} (${player.team})`);
          existingPlayerIds.add(player.id);
          fixedCount++;
        } catch (error) {
          console.log(`  Error adding ${pos} pick: ${error.message}`);
        }
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Added ${fixedCount} missing picks`);
    console.log(`\nAll bots should now have 8 picks each for Week 13`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixWeek13BotPicks();
