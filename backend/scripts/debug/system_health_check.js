#!/usr/bin/env node
/**
 * system_health_check.js
 *
 * Diagnostic script for platform health checks.
 * Inspects:
 * - Upcoming PGA contests (SCHEDULED)
 * - Contest templates for next PGA event
 * - Latest PGA event ingestion
 * - Recent withdrawals
 * - Stripe account linkage
 *
 * Usage:
 *   DATABASE_URL=<url> node system_health_check.js
 */

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function formatTable(title, rows) {
  if (!rows || rows.length === 0) {
    console.log(`\n📊 ${title}`);
    console.log('   (no results)\n');
    return;
  }

  console.log(`\n📊 ${title}`);
  console.log(rows);
}

async function runHealthCheck() {
  let client;
  try {
    client = await pool.connect();

    // SECTION 1: Upcoming PGA contests (SCHEDULED)
    console.log('\n' + '='.repeat(70));
    console.log('SECTION 1 — Upcoming PGA Contests (SCHEDULED)');
    console.log('='.repeat(70));

    const contestsResult = await client.query(`
      SELECT
        id,
        status,
        contest_name,
        tournament_start_time,
        entry_fee_cents,
        max_entries,
        template_id
      FROM contest_instances
      WHERE status = 'SCHEDULED'
      ORDER BY tournament_start_time DESC
      LIMIT 10
    `);

    if (contestsResult.rows.length > 0) {
      console.table(contestsResult.rows.map(row => ({
        'ID': row.id.slice(0, 8) + '...',
        'Status': row.status,
        'Name': row.contest_name,
        'Start Time': row.tournament_start_time ? new Date(row.tournament_start_time).toISOString() : 'N/A',
        'Entry Fee ($)': (row.entry_fee_cents / 100).toFixed(2),
        'Max Entries': row.max_entries,
        'Template ID': row.template_id.slice(0, 8) + '...'
      })));
    } else {
      console.log('   ⚠️  No SCHEDULED contests found');
    }

    // SECTION 2: Contest templates for PGA
    console.log('\n' + '='.repeat(70));
    console.log('SECTION 2 — Contest Templates (Sport: PGA)');
    console.log('='.repeat(70));

    const templatesResult = await client.query(`
      SELECT
        id,
        name,
        sport,
        provider_tournament_id,
        season_year,
        status,
        is_system_generated
      FROM contest_templates
      WHERE sport = 'PGA'
      ORDER BY season_year DESC, created_at DESC
      LIMIT 10
    `);

    if (templatesResult.rows.length > 0) {
      console.table(templatesResult.rows.map(row => ({
        'ID': row.id.slice(0, 8) + '...',
        'Name': row.name,
        'Sport': row.sport,
        'Provider Tournament ID': row.provider_tournament_id || 'N/A',
        'Season Year': row.season_year || 'N/A',
        'Status': row.status,
        'System Generated': row.is_system_generated ? 'Yes' : 'No'
      })));
    } else {
      console.log('   ⚠️  No PGA templates found');
    }

    // SECTION 3: Count of instances per template
    console.log('\n' + '='.repeat(70));
    console.log('SECTION 3 — Contest Instance Count per Template');
    console.log('='.repeat(70));

    const countResult = await client.query(`
      SELECT
        t.id,
        t.name,
        COUNT(c.id) as instance_count,
        COUNT(CASE WHEN c.status = 'SCHEDULED' THEN 1 END) as scheduled_count,
        COUNT(CASE WHEN c.status = 'LOCKED' THEN 1 END) as locked_count,
        COUNT(CASE WHEN c.status = 'LIVE' THEN 1 END) as live_count,
        COUNT(CASE WHEN c.status = 'COMPLETE' THEN 1 END) as complete_count
      FROM contest_templates t
      LEFT JOIN contest_instances c ON t.id = c.template_id
      WHERE t.sport = 'PGA'
      GROUP BY t.id, t.name
      ORDER BY t.season_year DESC, t.created_at DESC
    `);

    if (countResult.rows.length > 0) {
      console.table(countResult.rows.map(row => ({
        'Template': row.name.slice(0, 25),
        'Total Instances': row.instance_count,
        'SCHEDULED': row.scheduled_count,
        'LOCKED': row.locked_count,
        'LIVE': row.live_count,
        'COMPLETE': row.complete_count
      })));
    } else {
      console.log('   ⚠️  No PGA templates found');
    }

    // SECTION 4: Recent withdrawals
    console.log('\n' + '='.repeat(70));
    console.log('SECTION 4 — Recent Withdrawals (Last 10)');
    console.log('='.repeat(70));

    const withdrawalsResult = await client.query(`
      SELECT
        id,
        user_id,
        status,
        amount_cents,
        method,
        requested_at,
        processed_at,
        failure_reason
      FROM wallet_withdrawals
      ORDER BY requested_at DESC
      LIMIT 10
    `);

    if (withdrawalsResult.rows.length > 0) {
      console.table(withdrawalsResult.rows.map(row => ({
        'ID': row.id.slice(0, 8) + '...',
        'User': row.user_id.slice(0, 8) + '...',
        'Status': row.status,
        'Amount ($)': (row.amount_cents / 100).toFixed(2),
        'Method': row.method,
        'Requested': row.requested_at ? new Date(row.requested_at).toISOString().split('T')[0] : 'N/A',
        'Processed': row.processed_at ? new Date(row.processed_at).toISOString().split('T')[0] : 'N/A',
        'Failure': row.failure_reason || 'N/A'
      })));
    } else {
      console.log('   ℹ️  No withdrawals found');
    }

    // SECTION 5: Stripe account linkage
    console.log('\n' + '='.repeat(70));
    console.log('SECTION 5 — Stripe Account Linkage (Users with Active Accounts)');
    console.log('='.repeat(70));

    const stripeResult = await client.query(`
      SELECT
        id,
        username,
        stripe_connected_account_id,
        created_at
      FROM users
      WHERE stripe_connected_account_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (stripeResult.rows.length > 0) {
      console.table(stripeResult.rows.map(row => ({
        'User ID': row.id.slice(0, 8) + '...',
        'Username': row.username || 'N/A',
        'Stripe Account': row.stripe_connected_account_id.slice(0, 12) + '...',
        'Created': new Date(row.created_at).toISOString().split('T')[0]
      })));
    } else {
      console.log('   ⚠️  No users with Stripe accounts found');
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('HEALTH CHECK SUMMARY');
    console.log('='.repeat(70));

    const summaryResult = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM contest_instances WHERE status = 'SCHEDULED') as scheduled_contests,
        (SELECT COUNT(*) FROM contest_templates WHERE sport = 'PGA') as pga_templates,
        (SELECT COUNT(*) FROM users WHERE stripe_connected_account_id IS NOT NULL) as users_with_stripe,
        (SELECT COUNT(*) FROM wallet_withdrawals WHERE status = 'REQUESTED') as pending_withdrawals,
        (SELECT COUNT(*) FROM wallet_withdrawals WHERE status = 'FAILED') as failed_withdrawals
    `);

    const summary = summaryResult.rows[0];
    console.log(`
  ✓ SCHEDULED Contests:       ${summary.scheduled_contests}
  ✓ PGA Templates:            ${summary.pga_templates}
  ✓ Users with Stripe:        ${summary.users_with_stripe}
  ✓ Pending Withdrawals:      ${summary.pending_withdrawals}
  ✓ Failed Withdrawals:       ${summary.failed_withdrawals}
    `);

    console.log('✅ Health check complete\n');

  } catch (err) {
    console.error('❌ Error during health check:', err.message);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  runHealthCheck();
}

module.exports = { runHealthCheck };
