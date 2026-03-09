#!/bin/bash
# /Users/iancarter/Documents/workspace/playoff-challenge/backend/scripts/fix_system_contest.sh
# Usage: ./fix_system_contest.sh <template_id>

set -euo pipefail

TEMPLATE_ID=$1
SYSTEM_ORGANIZER_ID="84cf24b4-ae8d-49dc-8985-9b69a5dcdb23"   # system organizer
MANUAL_EVENT_ID="manual_test_event"
ENTRY_FEE=5000
MAX_ENTRIES=20
PAYOUT='{"type":"percentage","min_entries":2,"payout_percentages":[0.5,0.3,0.2]}'

echo "[i] Archiving leftover CANCELLED or placeholder contests..."
psql $DATABASE_URL <<EOF
BEGIN;
UPDATE contest_instances
SET status='CANCELLED'
WHERE template_id='$TEMPLATE_ID'
  AND provider_event_id IN ('espn_pga_401811937', 'manual_test_event_placeholder')
  AND status<>'CANCELLED';
COMMIT;
EOF

echo "[i] Ensuring proper SCHEDULED system contest exists..."
psql $DATABASE_URL <<EOF
BEGIN;
INSERT INTO contest_instances (
  id, template_id, organizer_id, contest_name, status, is_system_generated,
  is_platform_owned, created_at, updated_at, entry_fee_cents, max_entries,
  payout_structure, provider_event_id
)
VALUES (
  gen_random_uuid(),
  '$TEMPLATE_ID',
  '$SYSTEM_ORGANIZER_ID',
  'THE PLAYERS Championship',
  'SCHEDULED',
  TRUE,
  TRUE,
  NOW(),
  NOW(),
  $ENTRY_FEE,
  $MAX_ENTRIES,
  '$PAYOUT',
  'espn_pga_401811937'
)
ON CONFLICT (provider_event_id, template_id) DO NOTHING;
COMMIT;
EOF

echo "[i] Running ingestion worker for template $TEMPLATE_ID..."
NODE_ENV=staging node workers/ingestionWorker.js --template_id $TEMPLATE_ID

echo "[i] Verifying SCHEDULED system contest..."
psql $DATABASE_URL -c "
SELECT id, contest_name, status, provider_event_id, organizer_id
FROM contest_instances
WHERE template_id='$TEMPLATE_ID'
  AND provider_event_id='espn_pga_401811937'
  AND status='SCHEDULED';
"