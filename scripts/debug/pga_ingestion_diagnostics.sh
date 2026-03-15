#!/bin/bash

# PGA Ingestion Pipeline Diagnostic Script
# Purpose: Verify ingestion pipeline state at each stage
# Usage: ./scripts/debug/pga_ingestion_diagnostics.sh

set -e

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable not set"
    exit 1
fi

echo ""
echo "===================================="
echo "PGA INGESTION DIAGNOSTICS"
echo "===================================="
echo ""

# SECTION 1 — Active PGA Events
echo "===================================="
echo "SECTION 1 — Active PGA Events"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    provider_event_id,
    sport,
    status,
    start_time,
    updated_at
FROM sports_events
WHERE sport = 'GOLF'
ORDER BY updated_at DESC
LIMIT 10;
EOF
echo ""

# SECTION 2 — Contest Templates
echo "===================================="
echo "SECTION 2 — Contest Templates"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    id,
    provider_tournament_id,
    season_year,
    status,
    created_at
FROM contest_templates
WHERE sport = 'GOLF'
ORDER BY created_at DESC
LIMIT 10;
EOF
echo ""

# SECTION 3 — Contest Instances
echo "===================================="
echo "SECTION 3 — Contest Instances"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    id,
    template_id,
    status,
    entry_fee_cents,
    created_at
FROM contest_instances
ORDER BY created_at DESC
LIMIT 10;
EOF
echo ""

# SECTION 4 — Ingestion Events
echo "===================================="
echo "SECTION 4 — Ingestion Events"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    event_type,
    provider_event_id,
    status,
    created_at
FROM ingestion_events
ORDER BY created_at DESC
LIMIT 25;
EOF
echo ""

# SECTION 5 — Snapshot Data
echo "===================================="
echo "SECTION 5 — Snapshot Data"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    provider_event_id,
    snapshot_type,
    created_at
FROM event_data_snapshots
ORDER BY created_at DESC
LIMIT 20;
EOF
echo ""

# SECTION 6 — Golfer Scores
echo "===================================="
echo "SECTION 6 — Golfer Scores"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    golfer_id,
    created_at
FROM golfer_event_scores
LIMIT 20;
EOF
echo ""

# SECTION 7 — Row Counts (Quick Health Check)
echo "===================================="
echo "SECTION 7 — Row Counts (Quick Health Check)"
echo "===================================="
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    (SELECT COUNT(*) FROM ingestion_events) AS ingestion_events,
    (SELECT COUNT(*) FROM event_data_snapshots) AS snapshots,
    (SELECT COUNT(*) FROM golfer_event_scores) AS golfer_scores;
EOF
echo ""

echo "===================================="
echo "DIAGNOSTICS COMPLETE"
echo "===================================="
echo ""
