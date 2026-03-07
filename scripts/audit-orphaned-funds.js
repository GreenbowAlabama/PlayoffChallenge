#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runAudit() {
  try {
    console.log('\n📊 ORPHANED FUNDS AUDIT\n');
    console.log('Database:', process.env.DATABASE_URL?.split('@')[1] || 'unknown');
    console.log('---\n');

    // Query 1: Cancelled contests
    console.log('1️⃣  CANCELLED CONTESTS:\n');
    const cancelledResult = await pool.query(
      `SELECT id, contest_name, status, created_at FROM contest_instances
       WHERE status = 'CANCELLED'
       ORDER BY created_at DESC
       LIMIT 20`
    );

    if (cancelledResult.rows.length === 0) {
      console.log('   ✓ No cancelled contests found\n');
    } else {
      console.log(`   Found ${cancelledResult.rows.length} cancelled contests:\n`);
      cancelledResult.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.contest_name || 'UNNAMED'}`);
        console.log(`      ID: ${row.id}`);
        console.log(`      Status: ${row.status}`);
        console.log(`      Created: ${row.created_at}\n`);
      });
    }

    // Query 2: Stranded funds by contest (from ledger)
    console.log('2️⃣  STRANDED FUNDS BY CONTEST:\n');
    const strandeResult = await pool.query(
      `SELECT
         ci.id,
         ci.contest_name,
         COUNT(DISTINCT l.user_id) as participant_count,
         SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as total_stranded_cents
       FROM contest_instances ci
       LEFT JOIN ledger l ON ci.id = l.contest_instance_id
         AND l.entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_DEBIT')
       WHERE ci.status = 'CANCELLED'
       GROUP BY ci.id, ci.contest_name
       ORDER BY total_stranded_cents DESC NULLS LAST`
    );

    if (strandeResult.rows.length === 0 || strandeResult.rows.every(r => r.total_stranded_cents === null)) {
      console.log('   ✓ No stranded funds found\n');
    } else {
      let grandTotal = 0;
      console.log(`   Found stranded funds across ${strandeResult.rows.length} contests:\n`);
      strandeResult.rows.forEach((row, i) => {
        const cents = row.total_stranded_cents || 0;
        const dollars = (cents / 100).toFixed(2);
        grandTotal += cents;
        console.log(`   ${i + 1}. ${row.contest_name || 'UNNAMED'}`);
        console.log(`      Participants: ${row.participant_count}`);
        console.log(`      Stranded: $${dollars} (${cents} cents)\n`);
      });
      console.log(`   💰 TOTAL STRANDED: $${(grandTotal / 100).toFixed(2)}\n`);
    }

    // Query 3: Affected users summary
    console.log('3️⃣  AFFECTED USERS SUMMARY:\n');
    const affectedResult = await pool.query(
      `SELECT
         COUNT(DISTINCT l.user_id) as total_affected_users,
         COUNT(DISTINCT CASE WHEN l.direction = 'DEBIT' THEN l.id END) as total_entries,
         SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE 0 END) as total_stranded_cents
       FROM ledger l
       WHERE l.contest_instance_id IN (
         SELECT id FROM contest_instances WHERE status = 'CANCELLED'
       )
       AND l.entry_type IN ('ENTRY_FEE', 'ENTRY_FEE_DEBIT')`
    );

    const affected = affectedResult.rows[0];
    if (!affected || affected.total_affected_users === null) {
      console.log('   ✓ No affected users\n');
    } else {
      const dollars = ((affected.total_stranded_cents || 0) / 100).toFixed(2);
      console.log(`   Total affected users: ${affected.total_affected_users}`);
      console.log(`   Total entries: ${affected.total_entries}`);
      console.log(`   Total stranded: $${dollars}\n`);
    }

    console.log('---\n✅ Audit complete.\n');

  } catch (err) {
    console.error('\n❌ Error running audit:\n', err.message, '\n');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAudit();
