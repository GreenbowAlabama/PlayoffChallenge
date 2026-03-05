#!/bin/bash
# Script to audit discovery service data completeness
# Run: ./scripts/audit-discovery-completeness.sh

set -e

echo "=========================================="
echo "DISCOVERY SERVICE DATA COMPLETENESS AUDIT"
echo "=========================================="
echo ""

# Connect to DB using environment variables
psql "$DATABASE_URL" << 'SQL'

\echo '=== 1. LIVE CONTEST TEMPLATE (reference) ==='
SELECT
  id, name, sport, template_type, status, is_system_generated, is_active, created_at
FROM contest_templates
WHERE id = '37c34399-2da5-438c-83e2-4377a9f697da';

\echo ''
\echo '=== 2. LIVE CONTEST INSTANCE (reference) ==='
SELECT
  id, template_id, status, lock_time, tournament_start_time, tournament_end_time,
  entry_fee_cents, payout_structure, is_platform_owned, created_at
FROM contest_instances
WHERE id = '43be32cf-a794-476b-9aa7-ce8a27de2901';

\echo ''
\echo '=== 3. FIELD SELECTIONS FOR LIVE CONTEST ==='
SELECT
  id, contest_instance_id, tournament_config_id, selection_json, created_at
FROM field_selections
WHERE contest_instance_id = '43be32cf-a794-476b-9aa7-ce8a27de2901';

\echo ''
\echo '=== 4. TOURNAMENT CONFIGS LINKED TO LIVE FIELD SELECTIONS ==='
SELECT
  tc.id, tc.contest_instance_id, tc.provider_event_id, tc.ingestion_endpoint,
  tc.event_start_date, tc.event_end_date, tc.round_count, tc.cut_after_round,
  tc.leaderboard_schema_version, tc.field_source, tc.published_at, tc.is_active, tc.created_at
FROM tournament_configs tc
WHERE tc.id IN (
  SELECT tournament_config_id FROM field_selections
  WHERE contest_instance_id = '43be32cf-a794-476b-9aa7-ce8a27de2901'
);

\echo ''
\echo '=== 5. ALL TABLES REFERENCED BY contest_instances (FK check) ==='
SELECT table_name, constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'contest_instances' AND constraint_type = 'FOREIGN KEY';

\echo ''
\echo '=== 6. CONTEST_PARTICIPANTS FOR LIVE CONTEST ==='
SELECT COUNT(*) as participant_count
FROM contest_participants
WHERE contest_instance_id = '43be32cf-a794-476b-9aa7-ce8a27de2901';

\echo ''
\echo '=== 7. ALL SYSTEM-GENERATED TEMPLATES (check if new ones exist) ==='
SELECT
  id, name, sport, template_type, status, is_system_generated, provider_tournament_id, season_year, created_at
FROM contest_templates
WHERE is_system_generated = true
ORDER BY created_at DESC;

\echo ''
\echo '=== 8. ALL CONTESTS FOR SYSTEM-GENERATED TEMPLATES ==='
SELECT
  ci.id, ci.template_id, ci.status, ci.provider_event_id,
  ct.name as template_name, ct.provider_tournament_id,
  ci.created_at
FROM contest_instances ci
JOIN contest_templates ct ON ci.template_id = ct.id
WHERE ct.is_system_generated = true
ORDER BY ci.created_at DESC;

\echo ''
\echo '=== 9. FIELD SELECTIONS FOR ALL SYSTEM-GENERATED CONTESTS ==='
SELECT
  fs.id, fs.contest_instance_id, fs.tournament_config_id, COUNT(*) OVER() as total_count
FROM field_selections fs
WHERE fs.contest_instance_id IN (
  SELECT ci.id FROM contest_instances ci
  JOIN contest_templates ct ON ci.template_id = ct.id
  WHERE ct.is_system_generated = true
)
ORDER BY fs.created_at DESC;

\echo ''
\echo '=== 10. SCHEMA: tournament_configs structure ==='
\d+ tournament_configs

\echo ''
\echo '=== 11. SCHEMA: field_selections structure ==='
\d+ field_selections

SQL

echo ""
echo "=========================================="
echo "AUDIT COMPLETE"
echo "=========================================="
