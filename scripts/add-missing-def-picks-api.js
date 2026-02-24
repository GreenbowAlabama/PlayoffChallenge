#!/usr/bin/env node
/**
 * Add missing DEF picks to bot accounts in Week 13 using the API
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

async function addMissingDefPicks() {
  try {
    console.log('Adding missing DEF picks to bot accounts in Week 13...\n');

    // Get leaderboard with picks to see who's missing DEF
    const leaderboard = await apiRequest('GET', '/api/leaderboard?weekNumber=13&includePicks=true');

    const bots = leaderboard.filter(u => u.email && u.email.includes('@test.com'));
    console.log(`Found ${bots.length} bot accounts\n`);

    // Get all available players to find DEF options
    const playersResponse = await apiRequest('GET', '/api/players');
    const players = playersResponse.players || playersResponse;
    const defPlayers = (Array.isArray(players) ? players : []).filter(p => p.position === 'DEF');

    console.log(`Found ${defPlayers.length} DEF players available\n`);

    let addedCount = 0;
    let skippedCount = 0;

    for (const bot of bots) {
      const picks = bot.picks || [];
      const hasDef = picks.some(p => p.position === 'DEF');

      if (hasDef) {
        console.log(`${bot.name}: Already has DEF, skipping`);
        skippedCount++;
        continue;
      }

      // Get existing player IDs for this bot
      const existingPlayerIds = picks.map(p => p.player_id);

      // Find a random DEF not already picked
      const availableDef = defPlayers.filter(p => !existingPlayerIds.includes(p.id));

      if (availableDef.length === 0) {
        console.log(`${bot.name}: No available DEF players (all picked), using random one`);
        const randomDef = defPlayers[Math.floor(Math.random() * defPlayers.length)];
        availableDef.push(randomDef);
      }

      // Pick a random DEF from available ones
      const defPlayer = availableDef[Math.floor(Math.random() * availableDef.length)];

      // Create the pick via API
      const pickData = {
        userId: bot.id,
        playerId: defPlayer.id,
        weekNumber: 13,
        multiplier: 2  // Week 13 should have 2x multiplier
      };

      try {
        await apiRequest('POST', '/api/picks', pickData);
        console.log(`${bot.name}: Added ${defPlayer.first_name} ${defPlayer.last_name} (${defPlayer.team}) - 2x multiplier`);
        addedCount++;
      } catch (error) {
        console.log(`${bot.name}: Error adding pick - ${error.message}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Successfully added: ${addedCount} DEF picks`);
    console.log(`Already had DEF: ${skippedCount} bots`);
    console.log(`Total bots: ${bots.length}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addMissingDefPicks();
