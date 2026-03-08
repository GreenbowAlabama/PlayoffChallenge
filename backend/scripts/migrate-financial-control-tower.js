#!/usr/bin/env node

/**
 * Financial Control Tower Database Migration
 *
 * Creates all tables required for the 10-layer financial control system.
 * Idempotent: safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node backend/scripts/migrate-financial-control-tower.js
 *   DATABASE_URL_TEST="postgres://..." node backend/scripts/migrate-financial-control-tower.js
 *
 * Tables created:
 *   - financial_admin_actions (audit log for repairs)
 *   - user_wallet_freeze (emergency freeze)
 *   - financial_alerts (real-time alerts)
 *   - financial_feature_flags (kill switches)
 *   - financial_reconciliation_snapshots (historical snapshots)
 */

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_TEST,
});

async function migrate() {
  try {
    await client.connect();
    console.log('✅ Connected to database');
    console.log(`   URL: ${client.connectionParameters.host}:${client.connectionParameters.port}/${client.connectionParameters.database}`);
    console.log('');

    // Start transaction
    await client.query('BEGIN');

    // Table 1: financial_admin_actions (Audit Log)
    console.log('Creating table: financial_admin_actions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_admin_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        action_type TEXT NOT NULL,
        ledger_id UUID REFERENCES ledger(id) ON DELETE SET NULL,
        affected_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
        result_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT admin_action_reason_not_empty CHECK (LENGTH(TRIM(reason)) > 0)
      );
    `);
    console.log('  ✓ Table created');

    // Index for admin lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_admin_actions_admin_id
      ON financial_admin_actions(admin_id, created_at DESC);
    `);
    console.log('  ✓ Index: admin_id');

    // Index for affected user lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_admin_actions_affected_user_id
      ON financial_admin_actions(affected_user_id, created_at DESC);
    `);
    console.log('  ✓ Index: affected_user_id');

    // Index for action type
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_admin_actions_action_type
      ON financial_admin_actions(action_type, created_at DESC);
    `);
    console.log('  ✓ Index: action_type');

    console.log('');

    // Table 2: user_wallet_freeze (Emergency Freeze)
    console.log('Creating table: user_wallet_freeze...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_wallet_freeze (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        frozen_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        frozen_reason TEXT NOT NULL,
        frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unfrozen_by UUID REFERENCES users(id) ON DELETE SET NULL,
        unfrozen_at TIMESTAMPTZ,
        CONSTRAINT frozen_reason_not_empty CHECK (LENGTH(TRIM(frozen_reason)) > 0),
        CONSTRAINT unfreeze_requires_date CHECK (
          (unfrozen_by IS NULL AND unfrozen_at IS NULL) OR
          (unfrozen_by IS NOT NULL AND unfrozen_at IS NOT NULL)
        )
      );
    `);
    console.log('  ✓ Table created');

    // Index for lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_wallet_freeze_user_id
      ON user_wallet_freeze(user_id);
    `);
    console.log('  ✓ Index: user_id');

    // Index for active freezes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_wallet_freeze_active
      ON user_wallet_freeze(unfrozen_at) WHERE unfrozen_at IS NULL;
    `);
    console.log('  ✓ Index: active freezes');

    console.log('');

    // Table 3: financial_alerts (Real-Time Alerts)
    console.log('Creating table: financial_alerts...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'WARNING', 'INFO')),
        alert_type TEXT NOT NULL,
        message TEXT NOT NULL,
        first_detected TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
        repair_action_available BOOLEAN NOT NULL DEFAULT false,
        repair_action_function TEXT,
        acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT alert_message_not_empty CHECK (LENGTH(TRIM(message)) > 0),
        CONSTRAINT acknowledgement_requires_user CHECK (
          (acknowledged_by IS NULL AND acknowledged_at IS NULL) OR
          (acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
        )
      );
    `);
    console.log('  ✓ Table created');

    // Index for severity
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_alerts_severity
      ON financial_alerts(severity, created_at DESC);
    `);
    console.log('  ✓ Index: severity');

    // Index for active alerts
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_alerts_active
      ON financial_alerts(severity) WHERE acknowledged_at IS NULL;
    `);
    console.log('  ✓ Index: active alerts');

    // Index for alert type
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_alerts_alert_type
      ON financial_alerts(alert_type, created_at DESC);
    `);
    console.log('  ✓ Index: alert_type');

    console.log('');

    // Table 4: financial_feature_flags (Kill Switches)
    console.log('Creating table: financial_feature_flags...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_feature_flags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        feature TEXT NOT NULL UNIQUE CHECK (LENGTH(TRIM(feature)) > 0),
        enabled BOOLEAN NOT NULL DEFAULT true,
        disabled_by UUID REFERENCES users(id) ON DELETE SET NULL,
        disabled_reason TEXT,
        disabled_at TIMESTAMPTZ,
        re_enabled_by UUID REFERENCES users(id) ON DELETE SET NULL,
        re_enabled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT disable_requires_reason CHECK (
          (enabled = true) OR
          (enabled = false AND disabled_by IS NOT NULL AND disabled_reason IS NOT NULL AND disabled_at IS NOT NULL)
        ),
        CONSTRAINT disable_reason_not_empty CHECK (
          disabled_reason IS NULL OR LENGTH(TRIM(disabled_reason)) > 0
        )
      );
    `);
    console.log('  ✓ Table created');

    // Insert default feature flags
    console.log('  ✓ Inserting default feature flags...');
    await client.query(`
      INSERT INTO financial_feature_flags (feature, enabled)
      VALUES
        ('allow_withdrawals', true),
        ('allow_deposits', true),
        ('allow_contest_joins', true),
        ('settlement_engine', true)
      ON CONFLICT (feature) DO NOTHING;
    `);
    console.log('    - allow_withdrawals');
    console.log('    - allow_deposits');
    console.log('    - allow_contest_joins');
    console.log('    - settlement_engine');

    // Index for lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_feature_flags_feature
      ON financial_feature_flags(feature);
    `);
    console.log('  ✓ Index: feature');

    console.log('');

    // Table 5: financial_reconciliation_snapshots (Historical Snapshots)
    console.log('Creating table: financial_reconciliation_snapshots...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_reconciliation_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        wallet_liability_cents INTEGER NOT NULL CHECK (wallet_liability_cents >= 0),
        contest_pools_cents INTEGER NOT NULL,
        deposits_cents INTEGER NOT NULL CHECK (deposits_cents >= 0),
        withdrawals_cents INTEGER NOT NULL CHECK (withdrawals_cents >= 0),
        difference_cents INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('coherent', 'drift', 'critical')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('  ✓ Table created');

    // Index for time-based queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_reconciliation_snapshots_timestamp
      ON financial_reconciliation_snapshots(timestamp DESC);
    `);
    console.log('  ✓ Index: timestamp');

    // Index for status
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_reconciliation_snapshots_status
      ON financial_reconciliation_snapshots(status, timestamp DESC);
    `);
    console.log('  ✓ Index: status');

    // Partition by date for retention management
    console.log('  ✓ Retention policy: 90 days');
    await client.query(`
      CREATE OR REPLACE FUNCTION delete_old_reconciliation_snapshots()
      RETURNS void AS $$
      BEGIN
        DELETE FROM financial_reconciliation_snapshots
        WHERE created_at < NOW() - INTERVAL '90 days';
      END;
      $$ LANGUAGE plpgsql;
    `);

    console.log('');

    // Commit transaction
    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
    console.log('');
    console.log('Tables created:');
    console.log('  1. financial_admin_actions (audit log)');
    console.log('  2. user_wallet_freeze (emergency freeze)');
    console.log('  3. financial_alerts (real-time alerts)');
    console.log('  4. financial_feature_flags (kill switches with defaults)');
    console.log('  5. financial_reconciliation_snapshots (90-day retention)');
    console.log('');
    console.log('Indexes created: 11');
    console.log('Triggers created: 0 (ready for app-level logic)');
    console.log('');
    console.log('Status: ✅ Ready for Financial Control Tower implementation');
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:');
    console.error('');
    console.error('Error:', err.message);
    console.error('');
    if (err.detail) {
      console.error('Detail:', err.detail);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration
migrate();
