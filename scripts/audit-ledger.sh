#!/usr/bin/env bash

echo ""
echo "======================================="
echo "67 GAMES LEDGER AUDIT"
echo "======================================="
echo ""

echo "1️⃣ Orphan ENTRY_FEE_REFUND (refund without entry fee)"
psql $DATABASE_URL -c "
SELECT
  u.email,
  l.contest_instance_id,
  l.amount_cents,
  l.created_at
FROM ledger l
JOIN users u ON u.id = l.user_id
WHERE l.entry_type = 'ENTRY_FEE_REFUND'
AND NOT EXISTS (
  SELECT 1
  FROM ledger l2
  WHERE l2.user_id = l.user_id
  AND l2.contest_instance_id = l.contest_instance_id
  AND l2.entry_type = 'ENTRY_FEE'
);
"

echo ""
echo "---------------------------------------"
echo ""

echo "2️⃣ Users with wallet balance but zero deposits"
psql $DATABASE_URL -c "
WITH balances AS (
  SELECT
    user_id,
    SUM(
      CASE
        WHEN direction = 'CREDIT' THEN amount_cents
        WHEN direction = 'DEBIT' THEN -amount_cents
      END
    ) AS balance
  FROM ledger
  GROUP BY user_id
)
SELECT
  u.email,
  balance
FROM balances b
JOIN users u ON u.id = b.user_id
WHERE balance > 0
AND NOT EXISTS (
  SELECT 1
  FROM ledger l
  WHERE l.user_id = b.user_id
  AND l.entry_type = 'WALLET_DEPOSIT'
);
"

echo ""
echo "---------------------------------------"
echo ""

echo "3️⃣ Negative wallet balances"
psql $DATABASE_URL -c "
WITH balances AS (
  SELECT
    user_id,
    SUM(
      CASE
        WHEN direction = 'CREDIT' THEN amount_cents
        WHEN direction = 'DEBIT' THEN -amount_cents
      END
    ) AS balance
  FROM ledger
  GROUP BY user_id
)
SELECT
  u.email,
  balance
FROM balances b
JOIN users u ON u.id = b.user_id
WHERE balance < 0;
"

echo ""
echo "---------------------------------------"
echo ""

echo "4️⃣ ENTRY_FEE_REFUND larger than ENTRY_FEE"
psql $DATABASE_URL -c "
SELECT
  u.email,
  l.contest_instance_id,
  SUM(CASE WHEN entry_type = 'ENTRY_FEE' THEN amount_cents ELSE 0 END) AS fees,
  SUM(CASE WHEN entry_type = 'ENTRY_FEE_REFUND' THEN amount_cents ELSE 0 END) AS refunds
FROM ledger l
JOIN users u ON u.id = l.user_id
GROUP BY u.email, l.contest_instance_id
HAVING SUM(CASE WHEN entry_type = 'ENTRY_FEE_REFUND' THEN amount_cents ELSE 0 END)
     >
       SUM(CASE WHEN entry_type = 'ENTRY_FEE' THEN amount_cents ELSE 0 END);
"

echo ""
echo "---------------------------------------"
echo ""

echo "5️⃣ Ledger balance summary"
psql $DATABASE_URL -c "
SELECT
  COUNT(*) AS ledger_entries,
  COUNT(DISTINCT user_id) AS users_with_ledger_activity
FROM ledger;
"

echo ""
echo "======================================="
echo "LEDGER AUDIT COMPLETE"
echo "======================================="
echo ""

