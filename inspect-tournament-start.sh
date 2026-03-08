#!/usr/bin/env bash

echo "======================================="
echo " TOURNAMENT START TIME INVESTIGATION "
echo "======================================="
echo "Timestamp: $(date)"
echo ""

psql "$DATABASE_URL" << 'SQL'

\pset border 2
\pset pager off

------------------------------------------------------------
-- TEMPLATE → PROVIDER EVENT
------------------------------------------------------------
SELECT
    id,
    name,
    sport,
    provider_tournament_id,
    status,
    created_at
FROM contest_templates
WHERE provider_tournament_id IS NOT NULL;

------------------------------------------------------------
-- TOURNAMENT CONFIGS
------------------------------------------------------------
SELECT *
FROM tournament_configs
ORDER BY created_at DESC
LIMIT 20;

------------------------------------------------------------
-- CONTEST INSTANCES FOR ARNOLD PALMER
------------------------------------------------------------
SELECT
    id,
    template_id,
    status,
    start_time,
    lock_time,
    created_at
FROM contest_instances
WHERE template_id = '37c34399-2da5-438c-83e2-4377a9f697da';

------------------------------------------------------------
-- LIFECYCLE TRANSITIONS FOR THE LIVE CONTEST
------------------------------------------------------------
SELECT *
FROM contest_state_transitions
WHERE contest_instance_id = '43be32cf-a794-476b-9aa7-ce8a27de2901'
ORDER BY created_at;

SQL

echo ""
echo "======================================="
echo " INVESTIGATION COMPLETE "
echo "======================================="
