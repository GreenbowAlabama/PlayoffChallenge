#!/usr/bin/env bash

echo "========================================="
echo " PLAYOFF CHALLENGE CONTEST TIMING AUDIT "
echo "========================================="
echo "Timestamp: $(date)"
echo ""

psql "$DATABASE_URL" << 'SQL'

\pset border 2
\pset null '(null)'
\pset pager off

------------------------------------------------------------
-- 1. RECENT CONTEST INSTANCES
------------------------------------------------------------
SELECT
    ci.id,
    ci.template_id,
    ci.status,
    ci.start_time,
    ci.lock_time,
    ci.created_at
FROM contest_instances ci
ORDER BY ci.created_at DESC
LIMIT 10;

------------------------------------------------------------
-- 2. ANY CONTESTS CURRENTLY LIVE
------------------------------------------------------------
SELECT
    ci.id,
    ci.template_id,
    ci.status,
    ci.start_time,
    ci.lock_time,
    NOW() AS current_time,
    (ci.start_time - NOW()) AS start_delta
FROM contest_instances ci
WHERE ci.status = 'LIVE'
ORDER BY ci.start_time;

------------------------------------------------------------
-- 3. UPCOMING CONTESTS (NEXT 10 DAYS)
------------------------------------------------------------
SELECT
    ci.id,
    ci.template_id,
    ci.status,
    ci.start_time,
    ci.lock_time,
    (ci.start_time - NOW()) AS time_until_start
FROM contest_instances ci
WHERE ci.start_time > NOW()
ORDER BY ci.start_time
LIMIT 20;

------------------------------------------------------------
-- 4. TEMPLATE CONFIGURATION
------------------------------------------------------------
SELECT
    ct.id,
    ct.name,
    ct.sport,
    ct.provider_tournament_id,
    ct.status,
    ct.created_at
FROM contest_templates ct
ORDER BY ct.created_at DESC
LIMIT 10;

------------------------------------------------------------
-- 5. STATE TRANSITIONS (RECENT)
------------------------------------------------------------
SELECT
    contest_instance_id,
    from_state,
    to_state,
    triggered_by,
    reason,
    created_at
FROM contest_state_transitions
ORDER BY created_at DESC
LIMIT 20;

------------------------------------------------------------
-- 6. CONTESTS MARKED LIVE BEFORE THEIR START TIME
------------------------------------------------------------
SELECT
    id,
    template_id,
    status,
    start_time,
    lock_time,
    NOW() AS current_time
FROM contest_instances
WHERE status = 'LIVE'
AND start_time > NOW();

SQL

echo ""
echo "========================================="
echo " AUDIT COMPLETE "
echo "========================================="
