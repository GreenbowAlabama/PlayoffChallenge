# Stripe LIVE Verification Runbook

**Purpose:** Deterministic live-money verification flow for pre-GA Stripe integration.

**Duration:** 4-6 hours
**Owner:** Ian Carter
**Rollback Owner:** Ian Carter
**Approval Required:** Yes (before Phase 1 execution)

---

## Prerequisites

- [ ] Stripe account in LIVE mode
- [ ] STRIPE_SECRET_KEY environment variable set to sk_live_...
- [ ] STRIPE_WEBHOOK_SECRET environment variable set to whsec_live_...
- [ ] Webhook endpoint verified: POST /api/webhooks/stripe responding
- [ ] Backend deployed to production (Railway)
- [ ] Database in production state with test user account
- [ ] iOS test build targeting production API (https://api.playoffchallenge.com)
- [ ] Monitoring dashboards accessible (Stripe, Railway logs, database)
- [ ] Backup of production database taken before Phase 1
- [ ] Rollback plan documented and team briefed

---

## Phase 1: Wallet Funding Test

**Purpose:** Verify wallet funding via Stripe works end-to-end without duplicate charges.

**Duration:** 30 minutes
**Financial Risk:** USD 1.00 per test card (expected loss)

### Step 1.1: Create Test User and Wallet

```bash
# SSH to production
ssh railway-production

# Run database query
psql $DATABASE_URL <<EOF
INSERT INTO users (id, email, username, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'test-ga-wallet-fund@example.com', 'test_ga_wallet_fund', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO wallets (id, user_id, balance, pending_cents, ledger_hash, created_at, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 0, 0, '', NOW(), NOW())
ON CONFLICT DO NOTHING;

SELECT id, user_id, balance FROM wallets WHERE user_id = '11111111-1111-1111-1111-111111111111';
EOF
```

**Expected Output:**
```
 id                   | user_id                          | balance
----------------------+----------------------------------+---------
 22222222-2222-2222-2... | 11111111-1111-1111-1111-111111... |       0
```

### Step 1.2: Fund Wallet via API (Test Card 1: Success)

Use Stripe test card 4242 4242 4242 4242 (always succeeds in LIVE mode with test key, will fail in production with test card).

**Actually:** In LIVE mode, use Stripe test card 5555 5555 5555 4444 which is a MasterCard test card that will be rejected in LIVE (safe for testing rejection handling).

```bash
IDEMPOTENCY_KEY_1="wallet-fund-test-1-$(date +%s)"

curl -X POST https://api.playoffchallenge.com/api/wallets/fund \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_1" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 100,
    "payment_method_type": "card",
    "stripe_payment_method_id": "pm_test_visa_success"
  }'
```

**Expected Response:**
```json
{
  "wallet_id": "22222222-2222-2222-2222-222222222222",
  "previous_balance": 0,
  "new_balance": 100,
  "transaction_id": "txn_live_...",
  "idempotency_key": "wallet-fund-test-1-...",
  "status": "completed"
}
```

### Step 1.3: Verify Database State After Fund

```bash
psql $DATABASE_URL <<EOF
-- Wallet balance should reflect deposit
SELECT id, balance, pending_cents FROM wallets WHERE id = '22222222-2222-2222-2222-222222222222';

-- Ledger should have exactly ONE entry (no duplicates)
SELECT COUNT(*) as ledger_entry_count FROM ledger
  WHERE wallet_id = '22222222-2222-2222-2222-222222222222'
  AND operation_type = 'DEPOSIT';

-- Verify ledger entry details
SELECT id, wallet_id, operation_type, amount_cents, idempotency_key, created_at
  FROM ledger
  WHERE wallet_id = '22222222-2222-2222-2222-222222222222'
  AND operation_type = 'DEPOSIT'
  ORDER BY created_at DESC LIMIT 1;

-- Verify Stripe charge exists and is linked correctly
SELECT charge_id, amount_cents, status FROM wallet_charges
  WHERE wallet_id = '22222222-2222-2222-2222-222222222222'
  ORDER BY created_at DESC LIMIT 1;
EOF
```

**Expected Results:**
- wallet.balance = 100
- ledger entry count = 1 (not 2, 3, or more)
- Stripe charge exists with status = 'succeeded'

### Step 1.4: Retry Fund with Same Idempotency Key (Idempotency Test)

```bash
curl -X POST https://api.playoffchallenge.com/api/wallets/fund \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_1" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 100,
    "payment_method_type": "card",
    "stripe_payment_method_id": "pm_test_visa_success"
  }'
```

**Expected Response:**
```json
{
  "wallet_id": "22222222-2222-2222-2222-222222222222",
  "previous_balance": 100,
  "new_balance": 100,
  "transaction_id": "txn_live_...",
  "status": "cached_result",
  "message": "Idempotency key already processed"
}
```

**MUST NOT HAPPEN:**
- No charge made to Stripe (verify in Stripe dashboard)
- Wallet balance remains 100 (not 200)
- No duplicate ledger entry created

### Step 1.5: Verify No Duplicate Charge in Stripe

```bash
# In Stripe Dashboard:
# 1. Navigate to Payments → Charges
# 2. Search for idempotency key: wallet-fund-test-1-...
# 3. Verify EXACTLY ONE charge exists
# 4. Amount: $1.00 USD
# 5. Status: Succeeded
# 6. No duplicate charges with same idempotency key
```

**PASS Criteria:**
- [ ] Wallet balance increased by 100 cents
- [ ] Exactly one ledger entry created (no duplicates)
- [ ] Retry with same idempotency key returns cached result
- [ ] No charge made on retry
- [ ] Stripe dashboard shows exactly one charge

---

## Phase 2: Contest Join Atomicity

**Purpose:** Verify contest join is atomic, respects capacity, prevents duplicates, and deducts funds correctly.

**Duration:** 45 minutes
**Financial Risk:** USD 10.00 per test

### Step 2.1: Create Test Contest

```bash
# Create contest as organizer
CONTEST_ID=$(curl -X POST https://api.playoffchallenge.com/api/custom-contests \
  -H "Authorization: Bearer <JWT_FOR_ORGANIZER>" \
  -H "Content-Type: application/json" \
  -d '{
    "contest_name": "GA Verification Test Contest",
    "entry_fee_cents": 1000,
    "max_entries": 3,
    "lock_time": "'$(date -u -d '+1 hour' +'%Y-%m-%dT%H:%M:%SZ')'",
    "tournament_start_time": "'$(date -u -d '+2 hours' +'%Y-%m-%dT%H:%M:%SZ')'",
    "tournament_end_time": "'$(date -u -d '+3 hours' +'%Y-%m-%dT%H:%M:%SZ')'",
    "type": "PGA",
    "payout_structure": {}
  }' | jq -r '.id')

echo "Created contest: $CONTEST_ID"
```

**Expected:**
```
Created contest: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 2.2: Fund Test User Wallet (Sufficient for One Join)

```bash
# Fund wallet with $15.00 (enough for one $10 join + buffer)
IDEMPOTENCY_KEY_2="wallet-fund-test-2-$(date +%s)"

curl -X POST https://api.playoffchallenge.com/api/wallets/fund \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_2" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 1500,
    "payment_method_type": "card",
    "stripe_payment_method_id": "pm_test_visa_success"
  }'

# Verify balance
curl -X GET https://api.playoffchallenge.com/api/wallets/me \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" | jq '.balance'
```

**Expected:** 1500

### Step 2.3: Join Contest (First Join - Should Succeed)

```bash
IDEMPOTENCY_KEY_JOIN_1="contest-join-ga-test-1-$(date +%s)"

curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_JOIN_1" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "success": true,
  "entry_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "contest_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "user_has_entered": true
}
```

### Step 2.4: Verify Wallet Deduction and Ledger Entry

```bash
psql $DATABASE_URL <<EOF
-- Wallet balance should be 500 (1500 - 1000)
SELECT id, balance FROM wallets WHERE user_id = '11111111-1111-1111-1111-111111111111';

-- Ledger should have TWO entries: DEPOSIT + ENTRY_FEE
SELECT operation_type, amount_cents, COUNT(*) as count
  FROM ledger
  WHERE wallet_id = '22222222-2222-2222-2222-222222222222'
  GROUP BY operation_type, amount_cents;

-- Contest participant should exist
SELECT id, user_id, contest_instance_id
  FROM contest_participants
  WHERE contest_instance_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  AND user_id = '11111111-1111-1111-1111-111111111111';

-- Entry count should be 1
SELECT entry_count FROM contest_instances WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
EOF
```

**Expected:**
- wallet.balance = 500
- Ledger has DEPOSIT (+1500) and ENTRY_FEE (-1000)
- contest_participants has one row
- contest_instances.entry_count = 1

### Step 2.5: Attempt Duplicate Join with Same Idempotency Key

```bash
curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_JOIN_1" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "success": true,
  "cached_result": true,
  "entry_id": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "message": "Idempotency key already processed"
}
```

### Step 2.6: Verify No Duplicate Ledger Entry

```bash
psql $DATABASE_URL <<EOF
-- Ledger should still have exactly TWO entries (DEPOSIT + ENTRY_FEE)
SELECT COUNT(*) as total_ledger_count FROM ledger
  WHERE wallet_id = '22222222-2222-2222-2222-222222222222';

-- Wallet balance should be UNCHANGED (still 500)
SELECT balance FROM wallets WHERE user_id = '11111111-1111-1111-1111-111111111111';

-- Entry count should be UNCHANGED (still 1)
SELECT entry_count FROM contest_instances WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
EOF
```

**Expected:**
- total_ledger_count = 2 (not 3 or 4)
- wallet.balance = 500 (not 0 or negative)
- entry_count = 1 (not 2)

### Step 2.7: Attempt Join After Capacity Reached

Create two additional test users and join them to reach capacity (max_entries = 3).

```bash
# Join with second user
curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER_2>" \
  -H "Idempotency-Key: contest-join-ga-test-2-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{}'

# Join with third user
curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER_3>" \
  -H "Idempotency-Key: contest-join-ga-test-3-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{}'

# Verify entry_count = 3
psql $DATABASE_URL -c "SELECT entry_count FROM contest_instances WHERE id = '$CONTEST_ID';"

# Attempt fourth join (should fail)
curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER_4>" \
  -H "Idempotency-Key: contest-join-ga-test-4-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response for Fourth Join:**
```json
{
  "success": false,
  "error_code": "CONTEST_FULL",
  "reason": "Contest is at maximum capacity"
}
```

**MUST NOT HAPPEN:**
- Fourth user's wallet deducted
- Fourth entry created in contest_participants
- Entry count incremented to 4

**PASS Criteria:**
- [ ] First join succeeds, wallet deducted 1000 cents
- [ ] Duplicate join (same idempotency key) returns cached result
- [ ] No duplicate ledger entries
- [ ] Wallet balance unchanged on retry
- [ ] Entry count unchanged on retry
- [ ] Fourth join rejected when at capacity
- [ ] Fourth user wallet NOT deducted when CONTEST_FULL

---

## Phase 3: Settlement Idempotency

**Purpose:** Verify settlement is idempotent, computes payouts deterministically, and does not duplicate transactions.

**Duration:** 30 minutes
**Financial Risk:** USD 0 (settlement uses wallet funds already collected)

### Step 3.1: Transition Contest to COMPLETE

```bash
# Get contest detail to verify current state
curl -X GET https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID \
  -H "Authorization: Bearer <JWT_FOR_ORGANIZER>" | jq '.status'

# Wait for tournament_end_time to pass (or use admin endpoint to force COMPLETE)
# Admin endpoint: POST /api/admin/contests/$CONTEST_ID/force-complete
# (if available in pre-GA)

curl -X POST https://api.playoffchallenge.com/api/admin/contests/$CONTEST_ID/force-complete \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:**
```json
{
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "COMPLETE"
}
```

### Step 3.2: Verify Settlement Record Created

```bash
psql $DATABASE_URL <<EOF
SELECT id, contest_instance_id, settled_at, rake_cents, total_entry_fees_cents
  FROM settlement_records
  WHERE contest_instance_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
EOF
```

**Expected:**
```
 id                   | contest_instance_id              | settled_at | rake_cents | total_entry_fees_cents
----------------------+----------------------------------+------------+------------+----------------------
 zzzzzzzz-zzzz-zzzz-... | xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxx... |   NOW()    |    300     |       3000
```

### Step 3.3: Verify Payout Ledger Entries

```bash
psql $DATABASE_URL <<EOF
SELECT ledger.id, ledger.wallet_id, users.username, ledger.operation_type, ledger.amount_cents, ledger.created_at
  FROM ledger
  JOIN wallets ON ledger.wallet_id = wallets.id
  JOIN users ON wallets.user_id = users.id
  WHERE ledger.operation_type = 'PAYOUT'
  AND wallets.user_id IN (
    SELECT user_id FROM contest_participants WHERE contest_instance_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  )
  ORDER BY ledger.created_at;
EOF
```

**Expected:**
- Three PAYOUT entries (one per winner)
- Each payout = (total_entry_fees - rake) / 3 = (3000 - 300) / 3 = 900 cents
- All payouts have unique ledger entries (no duplicates)

### Step 3.4: Manually Trigger Settlement Again (Idempotency Test)

```bash
# Simulate settlement run again (e.g., if reconciler runs twice)
curl -X POST https://api.playoffchallenge.com/api/admin/contests/$CONTEST_ID/settle \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "id": "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
  "status": "already_settled",
  "message": "Contest already settled, returning existing settlement record"
}
```

### Step 3.5: Verify No Duplicate Payout Ledger Entries

```bash
psql $DATABASE_URL <<EOF
SELECT operation_type, COUNT(*) as count
  FROM ledger
  WHERE operation_type = 'PAYOUT'
  AND created_at >= NOW() - INTERVAL '10 minutes'
  GROUP BY operation_type;
EOF
```

**Expected:**
- count = 3 (not 6, 9, or more)

### Step 3.6: Verify Wallet Balances Updated Correctly

```bash
psql $DATABASE_URL <<EOF
SELECT users.username, wallets.balance
  FROM wallets
  JOIN users ON wallets.user_id = users.id
  WHERE users.id IN (
    SELECT user_id FROM contest_participants WHERE contest_instance_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  )
  ORDER BY users.username;
EOF
```

**Expected:**
- Each participant's balance = initial_balance - entry_fee + payout
- Example: User with 1500 balance, joined (paid 1000), won, received 900 payout = 1400 balance

**PASS Criteria:**
- [ ] Settlement record created with deterministic rake calculation
- [ ] Payout ledger entries created (3 entries for 3 participants)
- [ ] Retry settlement returns "already_settled" (idempotent)
- [ ] No duplicate payout ledger entries
- [ ] User wallet balances reflect payouts correctly
- [ ] Payout math verified: (entry_fees - rake) / winners

---

## Phase 4: Failure Case Simulation

**Purpose:** Verify system handles failure scenarios gracefully and does not lose money.

**Duration:** 45 minutes

### Step 4.1: Simulate Stripe Webhook Delivery Failure

**Scenario:** Stripe charge succeeds, but webhook delivery fails (Stripe will retry).

```bash
# Pause webhook handler (temporary)
# Option 1: Temporarily block webhook endpoint
# Option 2: Set invalid webhook secret to cause signature failure

# Attempt wallet fund
IDEMPOTENCY_KEY_FAIL="wallet-fund-fail-1-$(date +%s)"

curl -X POST https://api.playoffchallenge.com/api/wallets/fund \
  -H "Authorization: Bearer <JWT_FOR_TEST_USER>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_FAIL" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 500,
    "payment_method_type": "card",
    "stripe_payment_method_id": "pm_test_visa_success"
  }'
```

**Expected Response:**
- API returns success (charge created)
- Webhook handler fails (but Stripe will retry)

### Step 4.2: Verify Charge Created But Wallet Not Funded

```bash
# Check Stripe dashboard for charge
# Status: Succeeded (charge taken from card)

# Check database for wallet funding ledger entry
psql $DATABASE_URL <<EOF
SELECT operation_type, COUNT(*) FROM ledger WHERE idempotency_key = 'wallet-fund-fail-1-...' GROUP BY operation_type;
EOF
```

**Expected:**
- Stripe charge exists with amount 500 cents
- Ledger has NO entry yet (webhook handler failed)
- Wallet balance unchanged

### Step 4.3: Manually Replay Webhook

```bash
# Simulate Stripe webhook retry (manually call webhook handler)
# In Stripe dashboard: Webhooks → Find event → Resend

# OR manually trigger in backend:
curl -X POST https://api.playoffchallenge.com/api/webhooks/stripe \
  -H "Stripe-Signature: <VALID_SIGNATURE>" \
  -H "Content-Type: application/json" \
  -d '<WEBHOOK_PAYLOAD_FROM_STRIPE>'
```

**Expected Result:**
- Ledger entry created (DEPOSIT)
- Wallet balance incremented
- Idempotency check prevents duplicate (charge already recorded)

**PASS Criteria:**
- [ ] Charge succeeded despite webhook failure
- [ ] Wallet not funded until webhook succeeds
- [ ] Manual webhook replay funds wallet correctly
- [ ] No duplicate charges or ledger entries

### Step 4.2: Simulate Negative Balance Attempt (Rejection Test)

**Scenario:** Try to deduct more than wallet balance (should fail before Stripe charge).

```bash
# Create new test user with balance = 100 cents
USER_ID_LOW_BALANCE='55555555-5555-5555-5555-555555555555'
WALLET_ID_LOW='66666666-6666-6666-6666-666666666666'

psql $DATABASE_URL <<EOF
INSERT INTO users (id, email, username) VALUES ('$USER_ID_LOW_BALANCE', 'test-low-balance@example.com', 'test_low_balance');
INSERT INTO wallets (id, user_id, balance) VALUES ('$WALLET_ID_LOW', '$USER_ID_LOW_BALANCE', 100);
EOF

# Attempt to join contest with 1000 cent fee (insufficient balance)
curl -X POST https://api.playoffchallenge.com/api/custom-contests/$CONTEST_ID/join \
  -H "Authorization: Bearer <JWT_FOR_LOW_BALANCE_USER>" \
  -H "Idempotency-Key: contest-join-low-balance-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "success": false,
  "error_code": "INSUFFICIENT_FUNDS",
  "reason": "Wallet balance insufficient to cover entry fee"
}
```

**MUST NOT HAPPEN:**
- Stripe charge made
- Wallet balance goes negative
- Ledger entry showing negative balance
- Contest participant created

### Step 4.3: Verify No Negative Balance in Database

```bash
psql $DATABASE_URL -c "SELECT id, balance FROM wallets WHERE balance < 0;"
```

**Expected:** Empty result set (no negative balances)

**PASS Criteria:**
- [ ] Insufficient balance check occurs BEFORE Stripe charge
- [ ] Error returned to user
- [ ] No Stripe charge made
- [ ] No negative wallet balance
- [ ] No participant entry created

---

## Final Validation

### Post-Test Cleanup

```bash
# Delete test users and related records
psql $DATABASE_URL <<EOF
DELETE FROM contest_participants WHERE contest_instance_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
DELETE FROM contest_instances WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
DELETE FROM ledger WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id LIKE '11111111%' OR user_id LIKE '55555555%');
DELETE FROM wallets WHERE user_id LIKE '11111111%' OR user_id LIKE '55555555%';
DELETE FROM users WHERE id LIKE '11111111%' OR id LIKE '55555555%';
EOF
```

### Summary Checklist

- [ ] Phase 1: Wallet funding idempotent (no duplicate charges)
- [ ] Phase 2: Contest join atomic (capacity enforced, duplicates prevented)
- [ ] Phase 3: Settlement idempotent (no duplicate payouts)
- [ ] Phase 4: Failure cases handled (no data loss, negative balance impossible)
- [ ] All wallet balances non-negative
- [ ] All ledger entries append-only (no updates)
- [ ] Stripe dashboard matches database state
- [ ] No orphaned charges without ledger entries
- [ ] Idempotency-Key prevents all duplicate mutations

### Sign-off

**Verification Completed By:** ___________________________

**Date:** __________________________

**Result:** PASS / FAIL (Circle one)

**Notes:** ________________________________________________________________

---

## Rollback Procedure (If FAIL)

1. Stop all new contest joins: Kill /api/custom-contests/:id/join endpoint
2. Stop all wallet funding: Kill /api/wallets/fund endpoint
3. Restore database from pre-GA backup
4. Disable Stripe LIVE integration (revert to TEST keys)
5. Investigate failure root cause
6. Fix and re-run runbook

