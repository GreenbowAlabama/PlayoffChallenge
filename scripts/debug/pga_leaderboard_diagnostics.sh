#!/bin/bash

# PGA Leaderboard Pipeline Diagnostic Script
# Purpose: Verify data presence and structure at each stage of the PGA leaderboard pipeline
# Usage: ./scripts/debug/pga_leaderboard_diagnostics.sh
#
# This is a READ-ONLY diagnostic script for production data inspection only.
# No modifications are made to any tables or data.

set -e

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable not set"
    exit 1
fi

echo ""
echo "===================================="
echo "PGA LEADERBOARD PIPELINE DIAGNOSTICS"
echo "===================================="
echo ""

# SECTION 1 — Identify Active PGA Contest
echo "===================================="
echo "SECTION 1 — Identify Active PGA Contest"
echo "===================================="
echo "Query: Find most recent LIVE/COMPLETE PGA contest (same logic as pgaLeaderboardDebugService.js)"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    ci.id as contest_instance_id,
    ci.status,
    ci.tournament_start_time,
    ci.tournament_end_time,
    ci.template_id,
    ct.sport as template_sport
FROM contest_instances ci
JOIN contest_templates ct ON ct.id = ci.template_id
WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
    AND ci.status IN ('LIVE', 'COMPLETE')
ORDER BY ci.tournament_start_time DESC
LIMIT 1;
EOF
echo ""

# SECTION 2 — Verify Snapshots Exist for Active Contest
echo "===================================="
echo "SECTION 2 — Verify Snapshots Exist for Active Contest"
echo "===================================="
echo "Query: Count event_data_snapshots per contest_instance_id"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    contest_instance_id,
    COUNT(*) as snapshot_count,
    MAX(ingested_at) as latest_snapshot_time,
    MIN(ingested_at) as earliest_snapshot_time
FROM event_data_snapshots
GROUP BY contest_instance_id
ORDER BY MAX(ingested_at) DESC
LIMIT 10;
EOF
echo ""

# SECTION 3 — Inspect Snapshot Payload Structure
echo "===================================="
echo "SECTION 3 — Inspect Snapshot Payload Structure"
echo "===================================="
echo "Query: Sample snapshot payloads and their JSON keys (to verify 'golfers' exists)"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    id,
    contest_instance_id,
    provider_event_id,
    ingested_at,
    jsonb_object_keys(payload) as payload_keys
FROM event_data_snapshots
ORDER BY ingested_at DESC
LIMIT 5;
EOF
echo ""

# SECTION 3b — Inspect Sample Payload Detail
echo "===================================="
echo "SECTION 3b — Sample Payload Structure (First Snapshot)"
echo "===================================="
echo "Query: Extract first 500 chars of payload to inspect golfers array structure"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    id,
    contest_instance_id,
    provider_event_id,
    payload -> 'golfers' as golfers_array_sample,
    jsonb_array_length(payload -> 'golfers') as golfer_count
FROM event_data_snapshots
ORDER BY ingested_at DESC
LIMIT 1;
EOF
echo ""

# SECTION 4 — Count Golfer Scores
echo "===================================="
echo "SECTION 4 — Count Golfer Scores by Contest"
echo "===================================="
echo "Query: Verify golfer_event_scores table has data linked to contests"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    contest_instance_id,
    COUNT(*) as golfer_score_count,
    COUNT(DISTINCT golfer_id) as unique_golfer_count,
    MAX(created_at) as latest_score_time
FROM golfer_event_scores
GROUP BY contest_instance_id
ORDER BY MAX(created_at) DESC
LIMIT 10;
EOF
echo ""

# SECTION 5 — Verify Golfer IDs Match Between Snapshots and Scores
echo "===================================="
echo "SECTION 5 — Verify Golfer ID Matching Between Snapshot & Scores"
echo "===================================="
echo "Query: Extract golfer_ids from snapshot payloads and compare with golfer_event_scores"
echo ""
psql "$DATABASE_URL" << 'EOF'
WITH snapshot_golfers AS (
    SELECT
        eds.contest_instance_id,
        eds.id as snapshot_id,
        jsonb_array_elements(eds.payload -> 'golfers') -> 'golfer_id' as golfer_id_from_snapshot
    FROM event_data_snapshots eds
),
snapshot_distinct_golfers AS (
    SELECT
        contest_instance_id,
        COUNT(DISTINCT golfer_id_from_snapshot) as golfers_in_snapshots,
        jsonb_agg(DISTINCT golfer_id_from_snapshot) as snapshot_golfer_ids
    FROM snapshot_golfers
    GROUP BY contest_instance_id
),
score_golfers AS (
    SELECT
        contest_instance_id,
        COUNT(DISTINCT golfer_id) as golfers_in_scores,
        jsonb_agg(DISTINCT golfer_id::text) as score_golfer_ids
    FROM golfer_event_scores
    GROUP BY contest_instance_id
)
SELECT
    COALESCE(sdg.contest_instance_id, sg.contest_instance_id) as contest_instance_id,
    COALESCE(sdg.golfers_in_snapshots, 0) as golfers_in_snapshots,
    COALESCE(sg.golfers_in_scores, 0) as golfers_in_scores,
    CASE
        WHEN sdg.golfers_in_snapshots = sg.golfers_in_scores THEN 'MATCH ✓'
        WHEN sdg.golfers_in_snapshots = 0 THEN 'NO_SNAPSHOTS'
        WHEN sg.golfers_in_scores = 0 THEN 'NO_SCORES'
        ELSE 'MISMATCH'
    END as alignment_status
FROM snapshot_distinct_golfers sdg
FULL OUTER JOIN score_golfers sg
    ON sdg.contest_instance_id = sg.contest_instance_id
ORDER BY COALESCE(sdg.contest_instance_id, sg.contest_instance_id);
EOF
echo ""

# SECTION 5b — Detailed Golfer ID Comparison (Active Contest Only)
echo "===================================="
echo "SECTION 5b — Golfer IDs in Snapshots (Active Contest)"
echo "===================================="
echo "Query: List all golfer_ids extracted from snapshot payloads"
echo ""
psql "$DATABASE_URL" << 'EOF'
WITH active_contest AS (
    SELECT ci.id
    FROM contest_instances ci
    JOIN contest_templates ct ON ct.id = ci.template_id
    WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
        AND ci.status IN ('LIVE', 'COMPLETE')
    ORDER BY ci.tournament_start_time DESC
    LIMIT 1
),
snapshot_golfers AS (
    SELECT
        DISTINCT (jsonb_array_elements(eds.payload -> 'golfers') -> 'golfer_id')::text as golfer_id
    FROM event_data_snapshots eds
    WHERE eds.contest_instance_id = (SELECT id FROM active_contest)
)
SELECT
    COUNT(*) as golfer_count,
    string_agg(golfer_id, ', ' ORDER BY golfer_id) as golfer_ids
FROM snapshot_golfers;
EOF
echo ""

# SECTION 5c — Golfer IDs in Scores (Active Contest)
echo "===================================="
echo "SECTION 5c — Golfer IDs in golfer_event_scores (Active Contest)"
echo "===================================="
echo "Query: List all unique golfer_ids in golfer_event_scores"
echo ""
psql "$DATABASE_URL" << 'EOF'
WITH active_contest AS (
    SELECT ci.id
    FROM contest_instances ci
    JOIN contest_templates ct ON ct.id = ci.template_id
    WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
        AND ci.status IN ('LIVE', 'COMPLETE')
    ORDER BY ci.tournament_start_time DESC
    LIMIT 1
)
SELECT
    COUNT(DISTINCT golfer_id) as unique_golfer_count,
    string_agg(DISTINCT golfer_id, ', ' ORDER BY golfer_id) as golfer_ids
FROM golfer_event_scores
WHERE contest_instance_id = (SELECT id FROM active_contest);
EOF
echo ""

# SECTION 6 — Inspect Ingestion Events
echo "===================================="
echo "SECTION 6 — Inspect Ingestion Pipeline Execution"
echo "===================================="
echo "Query: Ingestion event types and validation status (shows pipeline phases)"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    event_type,
    validation_status,
    COUNT(*) as count,
    MAX(created_at) as latest_execution
FROM ingestion_events
GROUP BY event_type, validation_status
ORDER BY MAX(created_at) DESC;
EOF
echo ""

# SECTION 6b — Active Contest Ingestion Events
echo "===================================="
echo "SECTION 6b — Ingestion Events for Active Contest"
echo "===================================="
echo "Query: Pipeline phases executed for the most recent PGA contest"
echo ""
psql "$DATABASE_URL" << 'EOF'
WITH active_contest AS (
    SELECT ci.id
    FROM contest_instances ci
    JOIN contest_templates ct ON ct.id = ci.template_id
    WHERE ct.sport IN ('PGA', 'pga', 'GOLF', 'golf')
        AND ci.status IN ('LIVE', 'COMPLETE')
    ORDER BY ci.tournament_start_time DESC
    LIMIT 1
)
SELECT
    event_type,
    validation_status,
    COUNT(*) as count,
    MAX(created_at) as latest_execution,
    MIN(created_at) as earliest_execution
FROM ingestion_events
WHERE contest_instance_id = (SELECT id FROM active_contest)
GROUP BY event_type, validation_status
ORDER BY MAX(created_at) DESC;
EOF
echo ""

# SECTION 7 — Summary Health Check
echo "===================================="
echo "SECTION 7 — Pipeline Health Summary"
echo "===================================="
echo "Query: Quick row count check across critical tables"
echo ""
psql "$DATABASE_URL" << 'EOF'
SELECT
    (SELECT COUNT(*) FROM contest_instances WHERE status IN ('LIVE', 'COMPLETE')) as active_contests,
    (SELECT COUNT(*) FROM contest_templates WHERE sport IN ('PGA', 'pga', 'GOLF', 'golf')) as pga_templates,
    (SELECT COUNT(*) FROM event_data_snapshots) as total_snapshots,
    (SELECT COUNT(*) FROM golfer_event_scores) as total_golfer_scores,
    (SELECT COUNT(*) FROM ingestion_events) as total_ingestion_events,
    (SELECT COUNT(*) FROM ingestion_events WHERE validation_status = 'VALID') as valid_ingestion_events;
EOF
echo ""

echo "===================================="
echo "DIAGNOSTICS COMPLETE"
echo "===================================="
echo ""
echo "Analysis Steps:"
echo "1. Check SECTION 1 — Does an active PGA contest exist?"
echo "2. Check SECTION 2 — Does that contest have snapshots?"
echo "3. Check SECTION 3 — Are snapshots properly structured with 'golfers' key?"
echo "4. Check SECTION 4 — Are golfer_event_scores populated?"
echo "5. Check SECTION 5 — Do golfer IDs in snapshots match golfer_event_scores?"
echo "6. Check SECTION 6 — Which ingestion phases executed?"
echo ""
