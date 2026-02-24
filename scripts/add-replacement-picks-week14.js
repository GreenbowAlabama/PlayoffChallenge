#!/usr/bin/env node
/**
 * Add replacement picks (1x multiplier) for users with eliminated players in Week 14
 * Run this script AFTER the week transition to fill incomplete rosters
 */
const https = require('https');

const API_BASE = 'https://playoffchallenge-production.up.railway.app';

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

async function getUsersWithIncompletePicks() {
  // Get all paid users
  const users = await apiRequest('GET', '/api/admin/users');
  const paidUsers = users.filter(u => u.paid);

  const usersToFix = [];

  for (const user of paidUsers) {
    const picks = await apiRequest('GET', `/api/picks/user/${user.id}`);
    const week14Picks = picks.filter(p => p.week_number === 14);

    if (week14Picks.length < 8) {
      // Count picks by position
      const positionCounts = {};
      week14Picks.forEach(pick => {
        positionCounts[pick.position] = (positionCounts[pick.position] || 0) + 1;
      });

      // Expected: QB:1, RB:2, WR:2, TE:1, K:1, DEF:1
      const required = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };
      const missing = [];

      for (const [position, count] of Object.entries(required)) {
        const current = positionCounts[position] || 0;
        const needed = count - current;
        for (let i = 0; i < needed; i++) {
          missing.push(position);
        }
      }

      if (missing.length > 0) {
        usersToFix.push({
          id: user.id,
          name: user.name || user.email,
          currentPicks: week14Picks.length,
          missing: missing
        });
      }
    }
  }

  return usersToFix;
}

async function addReplacementPicks() {
  try {
    console.log('Finding users with incomplete Week 14 rosters...\n');

    const usersToFix = await getUsersWithIncompletePicks();

    if (usersToFix.length === 0) {
      console.log('✓ All users have complete rosters for Week 14');
      return;
    }

    console.log(`Found ${usersToFix.length} user(s) with incomplete rosters:\n`);
    usersToFix.forEach(u => {
      console.log(`  ${u.name}: ${u.currentPicks}/8 picks (missing: ${u.missing.join(', ')})`);
    });
    console.log('');

    // Get available players by position
    const playersByPosition = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      const response = await apiRequest('GET', `/api/players?position=${pos}&limit=500`);
      playersByPosition[pos] = response.players || [];
      console.log(`Loaded ${playersByPosition[pos].length} ${pos} players`);
    }
    console.log('');

    let totalAdded = 0;

    for (const user of usersToFix) {
      console.log(`${user.name}: Adding ${user.missing.length} replacement pick(s)`);

      // Get existing picks to avoid duplicates
      const existingPicks = await apiRequest('GET', `/api/picks/user/${user.id}`);
      const week14Picks = existingPicks.filter(p => p.week_number === 14);
      const existingPlayerIds = new Set(week14Picks.map(p => p.player_id));

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
          weekNumber: 14,
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
    console.log(`\nNext step: Trigger stats update for Week 14`);
    console.log(`curl -X POST "${API_BASE}/api/admin/update-live-stats" -H "Content-Type: application/json" -d '{"weekNumber": 14}'`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addReplacementPicks();
