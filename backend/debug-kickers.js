const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

(async () => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.espn_id,
        p.full_name,
        p.position,
        LENGTH(p.position) as pos_length,
        p.team,
        pk.user_id
      FROM picks pk
      JOIN players p ON p.id::text = pk.player_id
      WHERE pk.week_number = 16
        AND (p.position = 'K' OR p.position LIKE '%K%' OR LOWER(p.full_name) LIKE '%kick%')
      ORDER BY p.full_name
    `);

    console.log('=== KICKERS FOR WEEK 16 ===');
    console.log(JSON.stringify(result.rows, null, 2));
    console.log(`\nTotal kickers found: ${result.rows.length}`);

    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
