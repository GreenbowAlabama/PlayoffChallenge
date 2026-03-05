#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set"
  exit 1
fi

echo ""
echo "=============================================="
echo "FULL DATABASE TABLE INVENTORY"
echo "=============================================="

psql "$DATABASE_URL" -c "
SELECT
    schemaname,
    tablename
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY tablename;
"

echo ""
echo "=============================================="
echo "PLAYER RELATED TABLES"
echo "=============================================="

psql "$DATABASE_URL" -c "
SELECT
    schemaname,
    tablename
FROM pg_tables
WHERE tablename ILIKE '%player%'
ORDER BY tablename;
"

echo ""
echo "=============================================="
echo "CONTEST RELATED TABLES"
echo "=============================================="

psql "$DATABASE_URL" -c "
SELECT
    schemaname,
    tablename
FROM pg_tables
WHERE tablename ILIKE '%contest%'
ORDER BY tablename;
"

echo ""
echo "=============================================="
echo "INGESTION RELATED TABLES"
echo "=============================================="

psql "$DATABASE_URL" -c "
SELECT
    schemaname,
    tablename
FROM pg_tables
WHERE tablename ILIKE '%ingest%'
   OR tablename ILIKE '%snapshot%'
   OR tablename ILIKE '%event%'
ORDER BY tablename;
"

echo ""
echo "=============================================="
echo "SCHEMA ENUMERATION COMPLETE"
echo "=============================================="

