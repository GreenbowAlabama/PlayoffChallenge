#!/usr/bin/env bash

set -e

echo "==== Iteration 05 E2E Verification ===="
echo
echo "Select environment:"
echo "1) Staging (DATABASE_URL)"
echo "2) Test (DATABASE_URL_TEST)"
echo
read -p "Enter choice (1 or 2): " ENV_CHOICE

if [ "$ENV_CHOICE" = "1" ]; then
  if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL is not set"
    exit 1
  fi
  DB_URL="$DATABASE_URL"
  echo "Using DATABASE_URL"
elif [ "$ENV_CHOICE" = "2" ]; then
  if [ -z "$DATABASE_URL_TEST" ]; then
    echo "DATABASE_URL_TEST is not set"
    exit 1
  fi
  DB_URL="$DATABASE_URL_TEST"
  echo "Using DATABASE_URL_TEST"
else
  echo "Invalid selection"
  exit 1
fi

echo
read -p "Enter contest_instance_id: " CONTEST_ID
read -p "Enter payout_job_id: " PAYOUT_JOB_ID

echo
echo "==== 1. Contest Status ===="
psql "$DB_URL" -c "
SELECT id, status, paid
FROM contest_instances
WHERE id = '$CONTEST_ID';
"

echo
echo "==== 2. Settlement Record ===="
psql "$DB_URL" -c "
SELECT id, contest_instance_id, settled_at, total_pool_cents
FROM settlement_records
WHERE contest_instance_id = '$CONTEST_ID'
ORDER BY settled_at DESC
LIMIT 1;
"

echo
echo "==== 3. Settlement Winners (JSONB Extract) ===="
psql "$DB_URL" -c "
SELECT
  (r.elem ->> 'user_id') AS user_id,
  (r.elem ->> 'rank')::int AS rank,
  (r.elem ->> 'amount_cents')::int AS amount_cents
FROM settlement_records sr,
LATERAL jsonb_array_elements(sr.results) AS r(elem)
WHERE sr.contest_instance_id = '$CONTEST_ID'
ORDER BY rank ASC;
"

echo
echo "==== 4. Payout Job ===="
psql "$DB_URL" -c "
SELECT id, status, total_payouts, completed_count, failed_count, started_at, completed_at
FROM payout_jobs
WHERE id = '$PAYOUT_JOB_ID';
"

echo
echo "==== 5. Payout Transfers ===="
psql "$DB_URL" -c "
SELECT id, user_id, status, stripe_transfer_id, failure_reason, attempt_count, idempotency_key
FROM payout_transfers
WHERE payout_job_id = '$PAYOUT_JOB_ID'
ORDER BY created_at ASC;
"

echo
echo "==== 6. Duplicate Transfer Rows Check ===="
psql "$DB_URL" -c "
SELECT contest_id, user_id, COUNT(*)
FROM payout_transfers
WHERE payout_job_id = '$PAYOUT_JOB_ID'
GROUP BY contest_id, user_id
HAVING COUNT(*) > 1;
"

echo
echo "==== 7. Duplicate Stripe Transfer ID Check ===="
psql "$DB_URL" -c "
SELECT stripe_transfer_id, COUNT(*)
FROM payout_transfers
WHERE payout_job_id = '$PAYOUT_JOB_ID'
  AND stripe_transfer_id IS NOT NULL
GROUP BY stripe_transfer_id
HAVING COUNT(*) > 1;
"

echo
echo "==== 8. Duplicate Idempotency Key Check ===="
psql "$DB_URL" -c "
SELECT idempotency_key, COUNT(*)
FROM payout_transfers
WHERE payout_job_id = '$PAYOUT_JOB_ID'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
"

echo
echo "==== 9. Ledger Entries ===="
psql "$DB_URL" -c "
SELECT id, user_id, entry_type, direction, amount_cents, idempotency_key
FROM ledger
WHERE reference_type = 'PAYOUT_TRANSFER'
  AND contest_instance_id = '$CONTEST_ID'
ORDER BY created_at ASC;
"

echo
echo "==== 10. Ledger vs Transfer Count Comparison ===="
psql "$DB_URL" -c "
SELECT
  (SELECT COUNT(*) FROM payout_transfers WHERE payout_job_id = '$PAYOUT_JOB_ID') AS transfer_count,
  (SELECT COUNT(*) FROM ledger WHERE reference_type = 'PAYOUT_TRANSFER' AND contest_instance_id = '$CONTEST_ID') AS ledger_count;
"

echo
echo
echo "==== Verification Complete ===="
echo
echo "Manual checks:"
echo "- No transfers stuck in pending or processing"
echo "- stripe_transfer_id present for completed rows"
echo "- failure_reason = DESTINATION_ACCOUNT_MISSING only when expected"
echo "- transfer_count matches ledger_count (for completed/Stripe-attempted transfers)"
echo
