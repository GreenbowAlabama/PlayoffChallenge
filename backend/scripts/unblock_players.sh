#!/bin/zsh
# File: /Users/iancarter/Documents/workspace/playoff-challenge/backend/scripts/unblock_players.sh

TEMPLATE_ID=$1
if [[ -z "$TEMPLATE_ID" ]]; then
  echo "Usage: $0 <template_id>"
  exit 1
fi

SYSTEM_ORGANIZER_ID="84cf24b4-ae8d-49dc-8985-9b69a5dcdb23"
MANUAL_EVENT_ID="manual_test_event"

echo "[i] Using organizer_id=$SYSTEM_ORGANIZER_ID"

# 1️⃣ Archive leftover cancelled system contests
echo "[1] Archiving leftover CANCELLED system contests..."
psql $DATABASE_URL << EOF
BEGIN;

UPDATE contest_instances
SET status = 'CANCELLED'
WHERE template_id = '$TEMPLATE_ID'
  AND provider_event_id = 'espn_pga_401811937'
  AND status = 'SCHEDULED'
  AND organizer_id = '$SYSTEM_ORGANIZER_ID';

COMMIT;
EOF

# 2️⃣ Insert system contest placeholder with all required fields
echo "[2] Inserting system contest placeholder..."
psql $DATABASE_URL << EOF
BEGIN;

INSERT INTO contest_instances (
  id, template_id, provider_event_id, contest_name,
  status, is_system_generated, is_platform_owned,
  organizer_id, entry_fee_cents, max_entries, payout_structure,
  created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  '$TEMPLATE_ID',
  'espn_pga_401811937',
  'THE PLAYERS Championship - THE PLAYERS Championship',
  'SCHEDULED',
  TRUE,
  TRUE,
  '$SYSTEM_ORGANIZER_ID',
  0,                     -- free entry for system contest
  20,                    -- max entries
  '{"type":"percentage","min_entries":2,"payout_percentages":[0.5,0.3,0.2]}',
  NOW(),
  NOW()
)
ON CONFLICT (provider_event_id, template_id) DO NOTHING;

COMMIT;
EOF

# 3️⃣ Run ingestion worker
echo "[3] Running ingestion worker..."
NODE_ENV=staging node /Users/iancarter/Documents/workspace/playoff-challenge/backend/workers/ingestionWorker.js --template_id $TEMPLATE_ID

# 4️⃣ Verify the SCHEDULED system contest
echo "[4] Verifying SCHEDULED system contest..."
psql $DATABASE_URL -c "
SELECT id, contest_name, status, provider_event_id, organizer_id
FROM contest_instances
WHERE template_id = '$TEMPLATE_ID'
  AND status = 'SCHEDULED';
"