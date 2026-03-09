require('dotenv').config()
const { Pool } = require('pg')
const crypto = require('crypto')

const PLATFORM_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000043'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

async function run() {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    console.log('Transaction started')

    const baseContestResult = await client.query(`
      SELECT
        ci.id,
        ci.template_id,
        ci.entry_fee_cents,
        ci.provider_event_id,
        ci.lock_time,
        ci.tournament_start_time,
        ci.tournament_end_time,
        ci.payout_structure,
        ct.name as template_name
      FROM contest_instances ci
      JOIN contest_templates ct ON ci.template_id = ct.id
      WHERE ci.is_platform_owned = true
      AND ct.template_type = 'PGA_TOURNAMENT'
      LIMIT 1
    `)

    if (baseContestResult.rows.length === 0) {
      throw new Error('No platform PGA contest found')
    }

    const baseContest = baseContestResult.rows[0]
    console.log('Base contest:', baseContest.id)

    const contestsResult = await client.query(`
      SELECT id, entry_fee_cents
      FROM contest_instances
      WHERE is_platform_owned = false
    `)

    let refundsIssued = 0

    for (const contest of contestsResult.rows) {

      const participants = await client.query(`
        SELECT user_id
        FROM contest_participants
        WHERE contest_instance_id = $1
      `,[contest.id])

      for (const p of participants.rows) {

        const key = `refund:${contest.id}:${p.user_id}`

        const r = await client.query(`
          INSERT INTO ledger
          (user_id,contest_instance_id,entry_type,direction,amount_cents,reference_type,reference_id,idempotency_key,created_at)
          VALUES ($1,$2,'ENTRY_FEE_REFUND','CREDIT',$3,'CONTEST',$2,$4,NOW())
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `,[p.user_id,contest.id,contest.entry_fee_cents,key])

        if (r.rowCount === 1) refundsIssued++
      }
    }

    console.log('Refunds issued:', refundsIssued)

    const cancelList = await client.query(`
      SELECT id,status
      FROM contest_instances
      WHERE is_platform_owned = false
    `)

    for (const c of cancelList.rows) {

      await client.query(`
        UPDATE contest_instances
        SET status='CANCELLED',updated_at=NOW()
        WHERE id=$1
      `,[c.id])

      await client.query(`
        INSERT INTO contest_state_transitions
        (contest_instance_id,from_state,to_state,triggered_by,reason)
        VALUES ($1,$2,'CANCELLED','ADMIN','System reset')
      `,[c.id,c.status || 'SCHEDULED'])
    }

    console.log('Contests cancelled:', cancelList.rows.length)

    const entryFees = [1000,2000,2500,10000]

    const existing = await client.query(`
      SELECT entry_fee_cents
      FROM contest_instances
      WHERE is_platform_owned = true
      AND template_id = $1
    `,[baseContest.template_id])

    const existingSet = new Set(existing.rows.map(r=>r.entry_fee_cents))

    const nameMap = {
      1000:'$10',
      2000:'$20',
      2500:'$25',
      10000:'$100'
    }

    for (const fee of entryFees) {

      if (existingSet.has(fee)) continue

      const id = crypto.randomUUID()
      const contestName = `${baseContest.template_name} ${nameMap[fee]}`

      await client.query(`
        INSERT INTO contest_instances
        (id,template_id,organizer_id,entry_fee_cents,payout_structure,status,contest_name,
         tournament_start_time,tournament_end_time,lock_time,provider_event_id,max_entries,
         is_platform_owned,is_system_generated,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,'SCHEDULED',$6,$7,$8,$9,$10,100,true,false,NOW(),NOW())
      `,[
        id,
        baseContest.template_id,
        PLATFORM_SYSTEM_USER_ID,
        fee,
        baseContest.payout_structure,
        contestName,
        baseContest.tournament_start_time,
        baseContest.tournament_end_time,
        baseContest.lock_time,
        baseContest.provider_event_id
      ])

      console.log('Created contest:', contestName)
    }

    await client.query('COMMIT')
    console.log('Reset complete')

  } catch (err) {

    await client.query('ROLLBACK')
    console.error('Reset failed')
    console.error(err)

  } finally {

    client.release()
    await pool.end()
    process.exit()
  }
}

run()
