// contestLifecycleTick.js

const { applyLifecycleTransition } = require('./contestLifecycleEngine');

async function tickLifecycle(pool, now = new Date()) {
  const result = await pool.query(
    `
    SELECT id
    FROM contest_instances
    WHERE
      (status = 'UPCOMING' AND start_time <= $1)
      OR
      (status = 'ACTIVE' AND end_time <= $1)
    ORDER BY start_time ASC
    LIMIT 100
    `,
    [now]
  );

  let changed = 0;

  for (const row of result.rows) {
    const transition = await applyLifecycleTransition(pool, row.id, now);
    if (transition.changed) {
      changed += 1;
    }
  }

  return {
    processed: result.rows.length,
    changed,
  };
}

module.exports = {
  tickLifecycle,
};
