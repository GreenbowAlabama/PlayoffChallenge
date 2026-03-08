#!/bin/bash
#
# Ledger Corruption Detail Script
#
# Isolates specific ledger rows causing integrity violations.
# Drills down into negative wallets, malformed entries, and orphaned data.
#
# Usage:
#   ./scripts/audit-ledger-corruption-detail.sh
#
# Results written to:
#   ./LEDGER_CORRUPTION_DETAIL_YYYY-MM-DD_HH-MM-SS/
#

set -e

# Timestamp for output directory
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_DIR="./LEDGER_CORRUPTION_DETAIL_${TIMESTAMP}"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "🔍 Running ledger corruption detail analysis..."
echo "📁 Results directory: $OUTPUT_DIR"
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Known negative balance users (from diagnostic run)
NEGATIVE_USER_1="ca6358a2-8d7d-451e-abac-32a83b5fb4dd"
NEGATIVE_USER_2="d08df3e3-0edd-4e55-bd1c-c8ad68f04c51"
NEGATIVE_USER_3="4b28e413-ddfb-4059-a513-4c9c06059b9e"

# Query 1: Identify the Exact Negative Wallet Entries
echo -e "${BLUE}[1/8]${NC} Ledger entries for negative-balance users..."
psql $DATABASE_URL << EOF > "$OUTPUT_DIR/01_negative_wallet_entries.txt" 2>&1
SELECT
  reference_id AS user_id,
  entry_type,
  direction,
  amount_cents/100.0 AS amount_usd,
  contest_instance_id,
  stripe_event_id,
  created_at
FROM ledger
WHERE reference_type='WALLET'
AND reference_id IN (
  '$NEGATIVE_USER_1',
  '$NEGATIVE_USER_2',
  '$NEGATIVE_USER_3'
)
ORDER BY reference_id, created_at;
EOF
cat "$OUTPUT_DIR/01_negative_wallet_entries.txt"
echo ""

# Query 2: Detect All Illegal ENTRY_FEE Credits
echo -e "${BLUE}[2/8]${NC} Illegal ENTRY_FEE CREDIT entries (should not exist)..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/02_illegal_entry_fee_credits.txt" 2>&1
SELECT
  id,
  reference_id AS user_id,
  direction,
  amount_cents/100.0 AS amount_usd,
  contest_instance_id,
  created_at
FROM ledger
WHERE entry_type='ENTRY_FEE'
AND direction='CREDIT'
ORDER BY created_at;
EOF
ILLEGAL_FEE_CREDITS=$(grep -c "^" "$OUTPUT_DIR/02_illegal_entry_fee_credits.txt" || echo "0")
if [ "$ILLEGAL_FEE_CREDITS" -le 2 ]; then
  echo -e "${GREEN}✓ No illegal ENTRY_FEE CREDIT entries found${NC}"
else
  echo -e "${RED}⚠️  Found illegal ENTRY_FEE CREDIT entries:${NC}"
  cat "$OUTPUT_DIR/02_illegal_entry_fee_credits.txt"
fi
echo ""

# Query 3: Detect Illegal ENTRY_FEE_REFUND Debits
echo -e "${BLUE}[3/8]${NC} Illegal ENTRY_FEE_REFUND DEBIT entries (should not exist)..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/03_illegal_refund_debits.txt" 2>&1
SELECT
  id,
  reference_id AS user_id,
  direction,
  amount_cents/100.0 AS amount_usd,
  contest_instance_id,
  created_at
FROM ledger
WHERE entry_type='ENTRY_FEE_REFUND'
AND direction='DEBIT';
EOF
ILLEGAL_REFUND_DEBITS=$(grep -c "^" "$OUTPUT_DIR/03_illegal_refund_debits.txt" || echo "0")
if [ "$ILLEGAL_REFUND_DEBITS" -le 2 ]; then
  echo -e "${GREEN}✓ No illegal ENTRY_FEE_REFUND DEBIT entries found${NC}"
else
  echo -e "${RED}⚠️  Found illegal ENTRY_FEE_REFUND DEBIT entries:${NC}"
  cat "$OUTPUT_DIR/03_illegal_refund_debits.txt"
fi
echo ""

# Query 4: Investigate Orphaned Ledger Entries
echo -e "${BLUE}[4/8]${NC} Orphaned ledger entries (NULL user_id or reference_id)..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/04_orphaned_entries.txt" 2>&1
SELECT
  id,
  entry_type,
  direction,
  amount_cents/100.0 AS amount_usd,
  reference_type,
  reference_id,
  stripe_event_id,
  created_at
FROM ledger
WHERE reference_id IS NULL
OR user_id IS NULL;
EOF
ORPHANED_COUNT=$(grep -c "^" "$OUTPUT_DIR/04_orphaned_entries.txt" || echo "0")
if [ "$ORPHANED_COUNT" -le 2 ]; then
  echo -e "${GREEN}✓ No orphaned ledger entries found${NC}"
else
  echo -e "${RED}⚠️  Found orphaned ledger entries:${NC}"
  cat "$OUTPUT_DIR/04_orphaned_entries.txt"
fi
echo ""

# Query 5: Verify Join Logic Integrity
echo -e "${BLUE}[5/8]${NC} ENTRY_FEE entries without corresponding participants..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/05_orphaned_entry_fees.txt" 2>&1
SELECT
  l.id,
  l.reference_id AS user_id,
  l.contest_instance_id,
  l.amount_cents/100.0 AS entry_fee,
  p.id AS participant_id
FROM ledger l
LEFT JOIN contest_participants p
ON p.user_id = l.reference_id
AND p.contest_instance_id = l.contest_instance_id
WHERE l.entry_type='ENTRY_FEE'
AND p.id IS NULL;
EOF
ORPHANED_FEES=$(grep -c "^" "$OUTPUT_DIR/05_orphaned_entry_fees.txt" || echo "0")
if [ "$ORPHANED_FEES" -le 2 ]; then
  echo -e "${GREEN}✓ All ENTRY_FEE entries have corresponding participants${NC}"
else
  echo -e "${RED}⚠️  Found ENTRY_FEE entries without participants (join not atomic):${NC}"
  cat "$OUTPUT_DIR/05_orphaned_entry_fees.txt"
fi
echo ""

# Query 6: Verify Withdrawal Balance Enforcement
echo -e "${BLUE}[6/8]${NC} Withdrawal amounts per user..."
psql $DATABASE_URL << 'EOF' > "$OUTPUT_DIR/06_withdrawals_per_user.txt" 2>&1
SELECT
  reference_id AS user_id,
  SUM(amount_cents)/100.0 AS withdrawn_usd
FROM ledger
WHERE entry_type='WALLET_WITHDRAWAL'
GROUP BY reference_id
ORDER BY withdrawn_usd DESC;
EOF
cat "$OUTPUT_DIR/06_withdrawals_per_user.txt"
echo ""

# Query 7: Full Ledger Timeline for Corrupted Users
echo -e "${BLUE}[7/8]${NC} Running wallet balance timeline for negative-balance users..."
psql $DATABASE_URL << EOF > "$OUTPUT_DIR/07_running_balance_timeline.txt" 2>&1
SELECT
  reference_id AS user_id,
  entry_type,
  direction,
  amount_cents/100.0 AS amount_usd,
  ROUND(SUM(
    CASE
      WHEN direction='CREDIT' THEN amount_cents
      WHEN direction='DEBIT'  THEN -amount_cents
    END
  ) OVER (
    PARTITION BY reference_id
    ORDER BY created_at
  ) / 100.0, 2) AS running_balance,
  created_at
FROM ledger
WHERE reference_type='WALLET'
AND reference_id IN (
  '$NEGATIVE_USER_1',
  '$NEGATIVE_USER_2',
  '$NEGATIVE_USER_3'
)
ORDER BY reference_id, created_at;
EOF
cat "$OUTPUT_DIR/07_running_balance_timeline.txt"
echo ""

# Create analysis report
echo -e "${BLUE}[8/8]${NC} Creating detailed analysis report..."
cat > "$OUTPUT_DIR/README.md" << 'ANALYSIS_EOF'
# Ledger Corruption Detail Analysis

## Queries Executed

1. **01_negative_wallet_entries.txt** — All ledger entries for the 3 users with negative balances
   - Shows which entry_types contributed to the negative state
   - Reveals the sequence of transactions

2. **02_illegal_entry_fee_credits.txt** — ENTRY_FEE entries with CREDIT direction
   - Entry fees should ONLY be DEBIT (user losing money)
   - Credits indicate reversed entries or data corruption
   - Should probably be ENTRY_FEE_REFUND instead

3. **03_illegal_refund_debits.txt** — ENTRY_FEE_REFUND entries with DEBIT direction
   - Refunds should ONLY be CREDIT (user gaining money back)
   - Debits indicate pure corruption
   - These rows are architectural violations

4. **04_orphaned_entries.txt** — Ledger rows with NULL user_id or reference_id
   - Shows entries that cannot be attributed to a user
   - May indicate incomplete webhook processing or test harness bugs

5. **05_orphaned_entry_fees.txt** — ENTRY_FEE entries without matching contest_participants
   - If join transaction is atomic, every ENTRY_FEE should have a participant
   - Missing participants indicate race conditions or transaction failures
   - Reveals if join logic is truly atomic

6. **06_withdrawals_per_user.txt** — Total withdrawn amount per user
   - Compare with deposit amounts to detect over-withdrawals
   - Users in negative state likely over-withdrew

7. **07_running_balance_timeline.txt** — Moment-by-moment wallet balance for corrupted users
   - Shows the EXACT transaction that pushed each user negative
   - Reveals whether balance enforcement failed
   - Identifies which entry_type caused the violation

## Critical Rules (Violated)

### Negative Balance Invariant ❌
```
wallet_balance >= 0  (always)
```

Any user in the list below violates this:
- ca6358a2-8d7d-451e-abac-32a83b5fb4dd: -$100
- d08df3e3-0edd-4e55-bd1c-c8ad68f04c51: -$30
- 4b28e413-ddfb-4059-a513-4c9c06059b9e: -$5

### Entry Type Direction Invariants ❌

| Entry Type | Must Be | Never Be |
|-----------|---------|----------|
| ENTRY_FEE | DEBIT | CREDIT |
| ENTRY_FEE_REFUND | CREDIT | DEBIT |
| WALLET_DEPOSIT | CREDIT | DEBIT |
| WALLET_WITHDRAWAL | DEBIT | CREDIT |

### Join Atomicity Invariant ❌

```
IF ledger has ENTRY_FEE for contest_instance_id + user_id
THEN contest_participants must have corresponding row
```

Violating this indicates join transactions are not atomic.

## Likely Root Causes

### 1. Withdrawal Processing Without Balance Check

If withdrawals do not re-validate balance in transaction:

```javascript
// ❌ WRONG (can go negative)
if (user.wallet_balance >= amount) {
  // But balance can change here in concurrent transaction!
}
await ledger.insertWithdrawal(amount);  // Goes negative
```

### 2. Reversal Logic Using Wrong Entry Type

```javascript
// ❌ WRONG
ledger.insert({ entry_type: 'ENTRY_FEE', direction: 'CREDIT' });

// ✅ RIGHT
ledger.insert({ entry_type: 'ENTRY_FEE_REFUND', direction: 'CREDIT' });
```

### 3. Manual Data Corrections

If admin scripts or migrations inserted rows without validation:

```sql
-- ❌ WRONG (no validation)
INSERT INTO ledger (...) VALUES (...);

-- ✅ RIGHT (validate balance)
BEGIN;
  SELECT balance FROM (SELECT SUM(...) FROM ledger WHERE user_id = ?) FOR UPDATE;
  IF balance < 0 THEN ROLLBACK; END IF;
COMMIT;
```

### 4. Join Transaction Not Truly Atomic

If participant insert and entry_fee debit are separate transactions:

```javascript
// ❌ WRONG (2 transactions)
await db.insertParticipant(...);       // Can fail here
await ledger.insertEntryFee(...);      // Orphaned entry fee

// ✅ RIGHT (1 transaction)
BEGIN;
  INSERT INTO contest_participants (...);
  INSERT INTO ledger (...);
COMMIT;
```

## Recommendations

### Immediate (Before Fix)

1. Review all 7 queries above to identify root cause
2. Do NOT implement fixes until root cause is clear
3. Document which ledger rows should be reversed/deleted

### Short-term (To Fix)

1. Identify all corrupted rows (use queries above)
2. Create reversal entries (ADJUSTMENT entries for manual correction)
3. Verify all users return to non-negative state
4. Audit which code path created each violation

### Long-term (To Prevent)

1. Add database trigger to enforce `wallet_balance >= 0`
2. Enforce entry_type direction in database CHECK constraint
3. Make join transaction fully atomic (one SQL transaction)
4. Add pre-withdrawal balance check inside transaction

## Database-Level Protection

Enforce negative balance prevention at database level:

```sql
CREATE TRIGGER prevent_negative_wallet
BEFORE INSERT ON ledger
FOR EACH ROW
EXECUTE FUNCTION check_wallet_balance();

CREATE FUNCTION check_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference_type = 'WALLET' THEN
    -- Calculate new balance
    IF (SELECT SUM(...) FROM ledger WHERE user_id = NEW.reference_id) < 0
    THEN
      RAISE EXCEPTION 'Negative wallet balance not allowed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

This prevents corruption even if application code has bugs.

## Next Steps

1. Review the 7 detail queries above
2. Identify which ledger rows caused each violation
3. Trace back to the code path that inserted those rows
4. Determine fix strategy (reversal entries vs direct deletion)
5. Implement database-level protections

ANALYSIS_EOF

echo -e "${GREEN}✅ Corruption detail analysis complete!${NC}"
echo ""
echo "📊 Results saved to: $OUTPUT_DIR"
echo ""
echo "Files to review:"
echo "  01_negative_wallet_entries.txt      — Transactions for -balance users"
echo "  02_illegal_entry_fee_credits.txt    — Wrong direction ENTRY_FEE"
echo "  03_illegal_refund_debits.txt        — Wrong direction refunds"
echo "  04_orphaned_entries.txt             — NULL user_id entries"
echo "  05_orphaned_entry_fees.txt          — ENTRY_FEE without participants"
echo "  06_withdrawals_per_user.txt         — Withdrawal totals per user"
echo "  07_running_balance_timeline.txt     — Moment-by-moment balance (KEY)"
echo "  README.md                           — This analysis guide"
echo ""
echo "Key file to review first:"
echo "  → 07_running_balance_timeline.txt (shows exact moment each user went negative)"
echo ""
