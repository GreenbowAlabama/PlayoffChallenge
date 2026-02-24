#!/usr/bin/env node
/**
 * Add replacement picks (1x multiplier) for users with eliminated players in Week 13
 */
const https = require('https');

const API_BASE = 'https://playoffchallenge-production.up.railway.app';

// Users with missing positions
const USERS_TO_FIX = [
  { id: '6bf8daf4-ea99-4e29-9e05-9f443c2c5874', name: 'Alpha Squad', missing: ['QB', 'RB'] },
  { id: '3de4fd59-1c66-4065-8613-7791523a3ab9', name: 'Papa Patrol', missing: ['RB', 'RB'] },
  { id: '1471a07b-6819-4728-9954-71f325127e12', name: 'Kilo Knights', missing: ['RB'] },
  { id: '59dbdcda-b71e-481c-8aa7-21477f43aff0', name: 'Bravo Battalion', missing: ['DEF'] },
  { id: '0483afa3-12b9-42c8-891f-40192f4619ba', name: 'Hotel Heroes', missing: ['RB'] },
  { id: 'efc6ba43-9146-4635-8de4-781c5978603f', name: 'Juliet Justice', missing: ['WR'] },
  { id: '71cd0bf4-49f7-493a-9f49-b7e3c2b20a23', name: 'India Infantry', missing: ['QB'] },
  { id: 'd7a6ddac-2e64-4d46-b7d4-b9277717b282', name: 'Quebec Quest', missing: ['DEF'] },
  { id: 'a4388dfb-4a93-4d44-8253-fe0a5efe3876', name: 'Lima Legion', missing: ['WR'] },
  { id: '2453e059-a28c-49b9-8234-f29ad7e0ace6', name: 'Mike Marines', missing: ['QB'] }
];

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

async function addReplacementPicks() {
  try {
    console.log('Adding replacement picks (1x multiplier) for users with eliminated players...\n');

    // Get available players by position
    const playersByPosition = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      const response = await apiRequest('GET', `/api/players?position=${pos}&limit=500`);
      playersByPosition[pos] = response.players || [];
      console.log(`Loaded ${playersByPosition[pos].length} ${pos} players`);
    }
    console.log('');

    let totalAdded = 0;

    for (const user of USERS_TO_FIX) {
      console.log(`${user.name}: Adding ${user.missing.length} replacement pick(s)`);

      // Get existing picks to avoid duplicates
      const existingPicks = await apiRequest('GET', `/api/picks/user/${user.id}`);
      const week13Picks = existingPicks.filter(p => p.week_number === 13);
      const existingPlayerIds = new Set(week13Picks.map(p => p.player_id));

      for (const position of user.missing) {
        // Find an available player not already picked
        const availablePlayers = playersByPosition[position].filter(p => !existingPlayerIds.has(p.id));

        if (availablePlayers.length === 0) {
          console.log(`  WARNING: No available ${position} players`);
          continue;
        }

        // Pick a random player
        const player = availablePlayers[Math.floor(Math.random() * availablePlayers.length)];

        // Add the pick with 1x multiplier (new replacement pick)
        const pickData = {
          userId: user.id,
          playerId: player.id,
          weekNumber: 13,
          position: position,  // Must include position field
          multiplier: 1  // 1x multiplier for replacement picks
        };

        try {
          await apiRequest('POST', '/api/picks', pickData);
          console.log(`  ✓ Added ${position}: ${player.first_name} ${player.last_name} (${player.team}) - 1x multiplier`);
          existingPlayerIds.add(player.id);
          totalAdded++;
        } catch (error) {
          console.log(`  ERROR adding ${position}: ${error.message}`);
        }
      }

      console.log('');
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully added ${totalAdded} replacement picks with 1x multipliers`);
    console.log(`All affected users should now have complete rosters`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addReplacementPicks();
