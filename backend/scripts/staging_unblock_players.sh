#!/usr/bin/env bash
set -euo pipefail

# Template ID for THE PLAYERS Championship
TEMPLATE_ID="1df7b52f-a699-41f8-95d4-45c01bc9c4a9"

# Temporary manual test provider_event_id
MANUAL_EVENT_ID="manual_test_event"

# 1️⃣ Archive any leftover cancelled contest for this template/event
psql $DATABASE_URL << EOF
BEGIN;

UPDATE contest_instances
SET status = 'ARCHIVED'
WHERE template_id = '$TEMPLATE_ID'
  AND provider_event_id = 'espn_pga_401811937'
  AND status = 'CANCELLED';

COMMIT;
