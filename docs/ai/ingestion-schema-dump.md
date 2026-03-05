# Ingestion Schema Dump Protocol

Purpose

Produce a deterministic snapshot of the database structure relevant to the ingestion pipeline so it can be uploaded to the architect for analysis.

This avoids guessing schema and prevents architectural drift.

---

## How to Run

From the repository root:

./scripts/inspect-ingestion-schema.sh > ingestion_schema_dump.txt

Upload the file:

ingestion_schema_dump.txt

---

## Script Definition

If the script does not exist, create it using the command below.

cat > /Users/iancarter/Documents/workspace/playoff-challenge/scripts/inspect-ingestion-schema.sh <<'SCRIPT'
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
echo "TABLE STRUCTURES"
echo "=============================================="

psql "$DATABASE_URL" -c "\d+ contest_templates"
psql "$DATABASE_URL" -c "\d+ contest_instances"
psql "$DATABASE_URL" -c "\d+ players"

echo ""
echo "=============================================="
echo "CONSTRAINTS"
echo "=============================================="

psql "$DATABASE_URL" -c "
SELECT
    conrelid::regclass AS table,
    conname,
    pg_get_constraintdef(oid)
FROM pg_constraint
ORDER BY table;
"

echo ""
echo "=============================================="
echo "SCHEMA ENUMERATION COMPLETE"
echo "=============================================="
SCRIPT

chmod +x /Users/iancarter/Documents/workspace/playoff-challenge/scripts/inspect-ingestion-schema.sh

---

## Upload Format

Upload the following file to the architect:

ingestion_schema_dump.txt

Do not summarize.

The full raw output is required for analysis.
