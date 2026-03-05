#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set"
  exit 1
fi

echo ""
echo "=============================================="
echo "PGA INGESTION TRACE (SCHEMA SAFE)"
echo "=============================================="

echo ""
echo "---- contest_templates (GOLF) ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  name,
  sport,
  template_type,
  provider_tournament_id,
  season_year,
  status,
  is_system_generated,
  is_active,
  created_at
FROM contest_templates
WHERE sport = 'GOLF'
ORDER BY created_at DESC
LIMIT 50;
"

echo ""
echo "---- contest_instances (GOLF templates) ----"
psql "$DATABASE_URL" -c "
SELECT
  ci.id,
  ci.template_id,
  ci.provider_event_id,
  ci.status,
  ci.start_time,
  ci.lock_time,
  ci.lock_at,
  ci.tournament_start_time,
  ci.tournament_end_time,
  ci.created_at
FROM contest_instances ci
JOIN contest_templates ct ON ct.id = ci.template_id
WHERE ct.sport = 'GOLF'
ORDER BY ci.created_at DESC
LIMIT 50;
"

echo ""
echo "---- TABLE STRUCTURES ----"
psql "$DATABASE_URL" -c "\d+ ingestion_events"
psql "$DATABASE_URL" -c "\d+ ingestion_validation_errors"
psql "$DATABASE_URL" -c "\d+ event_data_snapshots"
psql "$DATABASE_URL" -c "\d+ players"
psql "$DATABASE_URL" -c "\d+ field_selections"
psql "$DATABASE_URL" -c "\d+ entry_rosters"
psql "$DATABASE_URL" -c "\d+ picks"
psql "$DATABASE_URL" -c "\d+ contest_participants"

echo ""
echo "---- ROW COUNTS ----"
psql "$DATABASE_URL" -c "
SELECT 'ingestion_events' AS table, COUNT(*) FROM ingestion_events
UNION ALL SELECT 'ingestion_validation_errors', COUNT(*) FROM ingestion_validation_errors
UNION ALL SELECT 'event_data_snapshots', COUNT(*) FROM event_data_snapshots
UNION ALL SELECT 'players', COUNT(*) FROM players
UNION ALL SELECT 'field_selections', COUNT(*) FROM field_selections
UNION ALL SELECT 'entry_rosters', COUNT(*) FROM entry_rosters
UNION ALL SELECT 'picks', COUNT(*) FROM picks
UNION ALL SELECT 'contest_participants', COUNT(*) FROM contest_participants;
"

echo ""
echo "---- SAMPLE ROWS (NO ASSUMED COLUMNS) ----"
psql "$DATABASE_URL" -c "SELECT * FROM ingestion_events LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT * FROM event_data_snapshots LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT * FROM players LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT * FROM field_selections LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT * FROM entry_rosters LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT * FROM picks LIMIT 10;"

echo ""
echo "=============================================="
echo "END PGA INGESTION TRACE"
echo "=============================================="
