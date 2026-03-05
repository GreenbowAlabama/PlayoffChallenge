#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set"
  exit 1
fi

echo ""
echo "=============================================="
echo "PGA INGESTION TRACE AUDIT"
echo "=============================================="

echo ""
echo "---- GOLF contest_templates ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  name,
  sport,
  template_type,
  provider_tournament_id,
  status,
  is_system_generated,
  created_at
FROM contest_templates
WHERE sport = 'GOLF'
ORDER BY created_at DESC;
"

echo ""
echo "---- contest_instances for GOLF templates ----"
psql "$DATABASE_URL" -c "
SELECT
  ci.id,
  ci.template_id,
  ci.status,
  ci.start_time,
  ci.lock_time,
  ci.created_at
FROM contest_instances ci
JOIN contest_templates ct
  ON ct.id = ci.template_id
WHERE ct.sport = 'GOLF'
ORDER BY ci.created_at DESC;
"

echo ""
echo "---- contest_instance_players ----"
psql "$DATABASE_URL" -c "
SELECT
  contest_instance_id,
  COUNT(*) AS player_count
FROM contest_instance_players
GROUP BY contest_instance_id
ORDER BY player_count DESC;
"

echo ""
echo "---- players total ----"
psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS total_players
FROM players;
"

echo ""
echo "---- players by sport ----"
psql "$DATABASE_URL" -c "
SELECT
  sport,
  COUNT(*) AS count
FROM players
GROUP BY sport
ORDER BY count DESC;
"

echo ""
echo "---- GOLF players sample ----"
psql "$DATABASE_URL" -c "
SELECT
  id,
  full_name,
  sport,
  created_at
FROM players
WHERE sport = 'GOLF'
ORDER BY created_at DESC
LIMIT 100;
"

echo ""
echo "---- contest_entries sanity ----"
psql "$DATABASE_URL" -c "
SELECT
  contest_instance_id,
  COUNT(*) AS entries
FROM contest_entries
GROUP BY contest_instance_id
ORDER BY entries DESC
LIMIT 20;
"

echo ""
echo "=============================================="
echo "END PGA INGESTION TRACE"
echo "=============================================="
