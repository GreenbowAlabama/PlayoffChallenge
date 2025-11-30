/**
 * Update main_rules section to remove player selection and deadline mentions
 */

const axios = require('axios');

const API_BASE_URL = 'https://playoffchallenge-production.up.railway.app';
const ADMIN_USER_ID = '0fe25279-ac51-482d-b5f1-86c16f35833b'; // Ian's admin user ID

const NEW_MAIN_RULES_CONTENT = `Players earn points in the playoffs via the configured scoring system, with a bonus multiplier. The fantasy points accumulated by each player during one weekly scoring period will be multiplied by the number of consecutive weeks in which the player has been in your lineup, assuming that player's team progresses through the playoffs. A player can earn bonus-point multipliers of 2x, 3x or 4x for a given week based on the number of consecutive weeks that player is on the fantasy team roster.

You can swap players out each week based on the matchups, but the multipliers reset with every change, so take that into consideration.

Players that are started the first week of playoffs with a bye, will not score any points that week, but will have a 2x multiplier the following week.`;

async function updateMainRules() {
  try {
    console.log('Fetching current rules...');
    const rulesResponse = await axios.get(`${API_BASE_URL}/api/rules`);
    const mainRule = rulesResponse.data.find(r => r.section === 'main_rules');

    if (!mainRule) {
      console.log('⚠️  No main_rules section found');
      return;
    }

    console.log(`\nUpdating main_rules (id: ${mainRule.id})...`);

    const updateResponse = await axios.put(
      `${API_BASE_URL}/api/admin/rules/${mainRule.id}`,
      {
        adminUserId: ADMIN_USER_ID,
        content: NEW_MAIN_RULES_CONTENT
      }
    );

    console.log('✅ Successfully updated main_rules section');
    console.log('\nNew content:');
    console.log(updateResponse.data.content);

  } catch (err) {
    console.error('Error updating main_rules:', err.response?.data || err.message);
  }
}

updateMainRules();
