#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set"
  exit 1
fi

echo ""
echo "=============================="
echo "PLAYOFF CHALLENGE DATA AUDIT"
echo "=============================="

echo ""
echo "---- contest_templates ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  name,
  sport,
  template_type,
  provider_tournament_id,
  is_system_generated,
  status,
  created_at
FROM contest_templates
ORDER BY created_at DESC;
"

echo ""
echo "---- contest_instances ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  template_id,
  provider_event_id,
  status,
  start_time,
  lock_time,
  tournament_start_time,
  tournament_end_time,
  created_at
FROM contest_instances
WHERE provider_event_id LIKE 'espn_pga_%'
ORDER BY created_at DESC;
"

echo ""
echo "---- players (latest 50) ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  espn_id,
  full_name,
  sport,
  position,
  team,
  created_at
FROM players
ORDER BY created_at DESC
LIMIT 50;
"

echo ""
echo "---- players grouped by sport ----"
psql "$DATABASE_URL" -c "
SELECT sport, COUNT(*)
FROM players
GROUP BY sport;
"

echo ""
echo "---- players with ESPN ids ----"
psql "$DATABASE_URL" -c "
SELECT
  espn_id,
  full_name,
  sport
FROM players
WHERE espn_id IS NOT NULL
ORDER BY full_name
LIMIT 50;
"

echo ""
echo "---- ingestion_events ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  contest_instance_id,
  provider,
  event_type,
  validation_status,
  created_at
FROM ingestion_events
ORDER BY created_at DESC
LIMIT 20;
"

echo ""
echo "---- ingestion payload preview ----"
psql "$DATABASE_URL" -c "
SELECT
  provider,
  event_type,
  left(provider_data_json::text,200) AS payload_preview
FROM ingestion_events
ORDER BY created_at DESC
LIMIT 5;
"

echo ""
echo "---- distinct provider events ----"
psql "$DATABASE_URL" -c "
SELECT DISTINCT provider_event_id
FROM contest_instances
ORDER BY provider_event_id;
"

echo ""
echo "=============================="
echo "END AUDIT"
echo "=============================="
