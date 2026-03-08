#!/bin/bash
#
# Ledger Financial Diagnostics Script
#
# Executes 10 diagnostic queries against the ledger table
# and writes results to timestamped files for review.
#
# Usage:
#   ./scripts/audit-ledger-diagnostics.sh
#
# Results written to:
#   ./LEDGER_DIAGNOSTICS_YYYY-MM-DD_HH-MM-SS/
#

set -e

# Timestamp for output directory
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_DIR="./LEDGER_DIAGNOSTICS_${TIMESTAMP}"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "📊 Running ledger diagnostics..."
echo "📁 Results directory: $OUTPUT_DIR"
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Query 1: Total User Wallet Liability
echo -e "${BLUE}[1/10]${NC} Total user wallet liability..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/01_user_wallet_liabilities.txt" 2>&1
SELECT
  ROUND(SUM(
    CASE
      WHEN direction = 'CREDIT' THEN amount_cents
      WHEN direction = 'DEBIT'  THEN -amount_cents
    END
  ) / 100.0, 2) AS user_wallet_liabilities_usd
FROM ledger
WHERE reference_type = 'WALLET';
EOF
cat "$OUTPUT_DIR/01_user_wallet_liabilities.txt"
echo ""

# Query 2: Total Deposits Recorded
echo -e "${BLUE}[2/10]${NC} Total deposits recorded..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/02_total_deposits.txt" 2>&1
SELECT
  COUNT(*)                    AS deposit_count,
  ROUND(SUM(amount_cents)/100.0,2) AS total_deposits_usd
FROM ledger
WHERE entry_type = 'WALLET_DEPOSIT';
EOF
cat "$OUTPUT_DIR/02_total_deposits.txt"
echo ""

# Query 3: Total Withdrawals
echo -e "${BLUE}[3/10]${NC} Total withdrawals..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/03_total_withdrawals.txt" 2>&1
SELECT
  COUNT(*) AS withdrawal_count,
  ROUND(SUM(amount_cents)/100.0,2) AS total_withdrawn_usd
FROM ledger
WHERE entry_type = 'WALLET_WITHDRAWAL'
AND direction = 'DEBIT';
EOF
cat "$OUTPUT_DIR/03_total_withdrawals.txt"
echo ""

# Query 4: Total Contest Entry Fees Collected
echo -e "${BLUE}[4/10]${NC} Total contest entry fees..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/04_entry_fees_collected.txt" 2>&1
SELECT
  COUNT(*) AS entry_count,
  ROUND(SUM(amount_cents)/100.0,2) AS total_entry_fees_usd
FROM ledger
WHERE entry_type = 'ENTRY_FEE'
AND direction = 'DEBIT';
EOF
cat "$OUTPUT_DIR/04_entry_fees_collected.txt"
echo ""

# Query 5: Total Prize Payouts
echo -e "${BLUE}[5/10]${NC} Total prize payouts..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/05_prize_payouts.txt" 2>&1
SELECT
  COUNT(*) AS payout_count,
  ROUND(SUM(amount_cents)/100.0,2) AS total_payouts_usd
FROM ledger
WHERE entry_type = 'PRIZE_PAYOUT'
AND direction = 'CREDIT';
EOF
cat "$OUTPUT_DIR/05_prize_payouts.txt"
echo ""

# Query 6: Detect Negative Wallets (Critical Safety Check)
echo -e "${BLUE}[6/10]${NC} Negative wallet detection (safety check)..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/06_negative_wallets.txt" 2>&1
SELECT
  reference_id AS user_id,
  ROUND(SUM(
    CASE
      WHEN direction='CREDIT' THEN amount_cents
      WHEN direction='DEBIT'  THEN -amount_cents
    END
  )/100.0,2) AS wallet_balance
FROM ledger
WHERE reference_type='WALLET'
GROUP BY reference_id
HAVING SUM(
  CASE
    WHEN direction='CREDIT' THEN amount_cents
    WHEN direction='DEBIT'  THEN -amount_cents
  END
) < 0;
EOF
NEGATIVE_COUNT=$(grep -c "^" "$OUTPUT_DIR/06_negative_wallets.txt" || echo "0")
if [ "$NEGATIVE_COUNT" -eq 1 ]; then
  echo -e "${GREEN}✓ No negative wallets found (expected)${NC}"
else
  echo "⚠️  WARNING: Negative wallets detected!"
  cat "$OUTPUT_DIR/06_negative_wallets.txt"
fi
echo ""

# Query 7: Stripe Event Coverage Check
echo -e "${BLUE}[7/10]${NC} Stripe event idempotency check..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/07_stripe_event_duplication.txt" 2>&1
SELECT
  stripe_event_id,
  COUNT(*) AS ledger_entries
FROM ledger
WHERE stripe_event_id IS NOT NULL
GROUP BY stripe_event_id
HAVING COUNT(*) > 1;
EOF
DUPLICATION_COUNT=$(grep -c "^" "$OUTPUT_DIR/07_stripe_event_duplication.txt" || echo "0")
if [ "$DUPLICATION_COUNT" -eq 1 ]; then
  echo -e "${GREEN}✓ No duplicate Stripe events (expected)${NC}"
else
  echo "⚠️  WARNING: Duplicate Stripe events detected!"
  cat "$OUTPUT_DIR/07_stripe_event_duplication.txt"
fi
echo ""

# Query 8: Full Ledger Breakdown
echo -e "${BLUE}[8/10]${NC} Full ledger breakdown by entry type..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/08_ledger_breakdown.txt" 2>&1
SELECT
  entry_type,
  direction,
  COUNT(*) AS count,
  ROUND(SUM(amount_cents)/100.0,2) AS total_usd
FROM ledger
GROUP BY entry_type, direction
ORDER BY entry_type, direction;
EOF
cat "$OUTPUT_DIR/08_ledger_breakdown.txt"
echo ""

# Query 9: Per-User Wallet Balance Table
echo -e "${BLUE}[9/10]${NC} Per-user wallet balances..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/09_user_wallet_balances.txt" 2>&1
SELECT
  reference_id AS user_id,
  ROUND(SUM(
    CASE
      WHEN direction='CREDIT' THEN amount_cents
      WHEN direction='DEBIT'  THEN -amount_cents
    END
  )/100.0,2) AS wallet_balance
FROM ledger
WHERE reference_type='WALLET'
GROUP BY reference_id
ORDER BY wallet_balance DESC;
EOF
cat "$OUTPUT_DIR/09_user_wallet_balances.txt"
echo ""

# Query 10: Contest Pool Integrity Check
echo -e "${BLUE}[10/10]${NC} Contest pool integrity check..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/10_contest_pool_integrity.txt" 2>&1
SELECT
  contest_instance_id,
  ROUND(SUM(
    CASE
      WHEN entry_type='ENTRY_FEE' AND direction='DEBIT'
      THEN amount_cents
      ELSE 0
    END
  )/100.0,2) AS entry_pool,
  ROUND(SUM(
    CASE
      WHEN entry_type='PRIZE_PAYOUT' AND direction='CREDIT'
      THEN amount_cents
      ELSE 0
    END
  )/100.0,2) AS payouts
FROM ledger
WHERE contest_instance_id IS NOT NULL
GROUP BY contest_instance_id
ORDER BY entry_pool DESC;
EOF
cat "$OUTPUT_DIR/10_contest_pool_integrity.txt"
echo ""

# Create summary report
echo -e "${BLUE}Creating summary report...${NC}"
cat > "$OUTPUT_DIR/README.md" << 'SUMMARY_EOF'
# Ledger Financial Diagnostics Report

## Queries Executed

1. **01_user_wallet_liabilities.txt** — Total money users collectively own (WALLET reference_type)
2. **02_total_deposits.txt** — Count and sum of WALLET_DEPOSIT entries
3. **03_total_withdrawals.txt** — Count and sum of WALLET_WITHDRAWAL debits
4. **04_entry_fees_collected.txt** — Count and sum of ENTRY_FEE debits (contest entry)
5. **05_prize_payouts.txt** — Count and sum of PRIZE_PAYOUT credits (contest winnings)
6. **06_negative_wallets.txt** — Safety check: users with negative balances (should be empty)
7. **07_stripe_event_duplication.txt** — Idempotency check: duplicate Stripe events (should be empty)
8. **08_ledger_breakdown.txt** — Complete ledger breakdown by entry_type and direction
9. **09_user_wallet_balances.txt** — All user wallet balances (sorted by balance DESC)
10. **10_contest_pool_integrity.txt** — Per-contest pool: entry fees vs payouts

## Audit Equation

The system is correct when:

```
Stripe_balance + Stripe_fees_paid
=
user_wallet_liabilities - platform_rake
```

From these queries:

- **user_wallet_liabilities** = Query 1 result
- **Stripe_balance** = From Stripe API `/v1/balance`
- **Stripe_fees_paid** = From Stripe dashboard or API
- **platform_rake** = From contest settlement records

## Critical Checks

### Safety Checks (should return 0 rows)

- **Query 6:** No negative wallets allowed
- **Query 7:** No duplicate Stripe events (idempotency maintained)

### Balance Checks

- **Query 2:** Total deposits should match Stripe activity
- **Query 3:** Withdrawals should match wallet deductions
- **Query 4 + 5:** Entry fees should relate to payouts (less rake)

## Next Steps

1. Review all query results
2. Compare Query 1 (user liabilities) against Stripe API balance
3. Verify Stripe fees are accounted for separately (not in wallet debit)
4. Check that no negative wallets exist (Query 6)
5. Verify idempotency maintained (Query 7)

## Files in This Directory

```
01_user_wallet_liabilities.txt
02_total_deposits.txt
03_total_withdrawals.txt
04_entry_fees_collected.txt
05_prize_payouts.txt
06_negative_wallets.txt
07_stripe_event_duplication.txt
08_ledger_breakdown.txt
09_user_wallet_balances.txt
10_contest_pool_integrity.txt
README.md (this file)
```

SUMMARY_EOF

echo -e "${GREEN}✅ All diagnostics complete!${NC}"
echo ""
echo "📊 Results saved to: $OUTPUT_DIR"
echo ""
echo "Next steps:"
echo "1. Review all .txt files in $OUTPUT_DIR"
echo "2. Check Query 6 and 7 (should be empty for health)"
echo "3. Compare Query 1 result to Stripe API balance"
echo "4. Verify audit equation balances"
echo ""
