# Wallet Feature QA Testing Plan

**Feature:** Wallet Balance & Ledger Display
**Platform:** iOS
**Environment:** Staging
**Date:** March 2, 2026

---

## Pre-Test Setup

### Requirements
- [ ] iOS app built and deployed to staging
- [ ] Staging backend `/api/wallet` endpoint operational
- [ ] Test user account with Stripe test funds
- [ ] iOS simulator or test device ready
- [ ] Xcode console open to view logs

### Test Users

| User ID | Scenario | Expected Wallet |
|---------|----------|-----------------|
| C1C74D6C-1D2C-4436-A29D-2F6891F3E813 | New user (no wallet) | $0.00 |
| [test-user-id] | User with balance | [actual amount] |
| [test-user-id-2] | User with transactions | [balance + ledger] |

---

## Test Cases

### TEST 1: Endpoint Validation
**Objective:** Verify `/api/wallet` returns correct contract
**Steps:**
```
1. Open Xcode Console
2. Run app
3. Sign in with test user
4. Navigate to Home tab
5. Observe logs for:
   [WalletService] Fetching wallet from: https://...
   [WalletService] Added Authorization header for userId: <uuid>
   [WalletService] Response status: ???
```

**Expected Result:**
- [ ] Log shows `Response status: 200`
- [ ] Response includes `balance_cents` (integer)
- [ ] Response includes `ledger` (optional array)
- [ ] No 401 Unauthorized errors

**Sample Response (Success):**
```json
{
  "balance_cents": 50000,
  "ledger": [
    {
      "id": "uuid",
      "amount_cents": 10000,
      "direction": "CREDIT",
      "entry_type": "WALLET_DEPOSIT",
      "reference_type": "WALLET",
      "reference_id": null,
      "created_at": "2026-03-02T10:00:00Z"
    }
  ]
}
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 2: HomeTabView Wallet Button Display
**Objective:** Verify wallet button appears and shows correct balance
**Steps:**
```
1. Start app fresh (force kill if running)
2. Sign in with test user (with balance)
3. Wait 2 seconds for home tab to load
4. Look at top-right of HomeTabView
5. Verify wallet button appears with icon + balance
```

**Expected Result:**
- [ ] Wallet button visible in top-right
- [ ] Shows wallet icon (💰)
- [ ] Displays formatted balance (e.g., "$500.00")
- [ ] Balance matches backend `/api/wallet` response
- [ ] No "Loading..." or error states

**Log Verification:**
```
[HomeTabView] Appeared - fetching wallet
[UserWalletViewModel] fetchWallet() ENTERED
[WalletService] Fetching wallet from: https://...
[WalletService] Response status: 200
[UserWalletViewModel] Wallet fetch succeeded: balance=<amount>¢
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Actual Balance Shown:** $_______
**Backend Balance:** $_______ (from logs)
**Match?** [ ] YES [ ] NO
**Notes:** _______________________________________________

---

### TEST 3: WalletDetailView Navigation & Display
**Objective:** Verify tapping wallet button navigates to detail view with correct data
**Steps:**
```
1. From HomeTabView, tap wallet button (top-right)
2. WalletDetailView should appear
3. Verify balance display at top
4. Verify transaction list below
5. Check ledger entries are correct
```

**Expected Result:**
- [ ] Navigation succeeds (no crash)
- [ ] Balance header displays same as button
- [ ] Ledger list shows all transactions
- [ ] Each entry shows:
  - [ ] Icon (emoji based on entry_type)
  - [ ] Entry type and timestamp
  - [ ] Amount with sign (+ for CREDIT, − for DEBIT)
  - [ ] Proper formatting (e.g., "+ $100.00")
  - [ ] Color coding (green for CREDIT, red for DEBIT)

**Sample Ledger Entry Display:**
```
💰 WALLET_DEPOSIT
  2026-03-02 10:00 AM
  +$100.00 (green)
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Number of Transactions Shown:** _______
**Notes:** _______________________________________________

---

### TEST 4: Pull-to-Refresh
**Objective:** Verify pull-to-refresh updates wallet data
**Steps:**
```
1. In WalletDetailView, pull down to refresh
2. Observe loading spinner appear
3. Wait for fetch to complete
4. Verify balance updates (if changed on backend)
5. Verify ledger refreshes
```

**Expected Result:**
- [ ] Pull gesture triggers refresh
- [ ] Loading spinner appears during fetch
- [ ] Spinner disappears after fetch completes
- [ ] Latest data displayed from backend
- [ ] No errors in logs

**Log Verification:**
```
[UserWalletViewModel] refreshBalance() called
[UserWalletViewModel] fetchWallet() ENTERED
[WalletService] Response status: 200
[UserWalletViewModel] Wallet fetch succeeded: balance=<amount>¢
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 5: New User (No Wallet) — 401 Fallback
**Objective:** Verify graceful handling when user has no wallet
**Steps:**
```
1. Create new test account (no wallet created)
2. Sign in with new account
3. Navigate to Home tab
4. Observe wallet button and logs
```

**Expected Result:**
- [ ] Backend returns 401 Unauthorized
- [ ] App does NOT show error
- [ ] Wallet button displays "$0.00"
- [ ] Log shows: "401 (treating as no wallet)"

**Log Verification:**
```
[WalletService] Response status: 401
[UserWalletViewModel] Fetch failed: 401 (treating as no wallet)
[UserWalletViewModel] Wallet fetch succeeded: balance=0¢
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 6: User Without Wallet — 404 Fallback
**Objective:** Verify graceful handling for 404 Not Found
**Steps:**
```
1. Use test account that backend explicitly doesn't have
2. Observe response and UI behavior
```

**Expected Result:**
- [ ] Backend returns 404 Not Found
- [ ] App does NOT show error
- [ ] Wallet button displays "$0.00"
- [ ] Log shows: "404 (no wallet)"

**Log Verification:**
```
[WalletService] Response status: 404
[UserWalletViewModel] Fetch failed: 404 (no wallet)
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 7: Logging Verification
**Objective:** Ensure all debug logs are present and correct
**Steps:**
```
1. Complete a full wallet fetch cycle
2. Capture logs
3. Verify all expected log lines present
```

**Expected Logs (in order):**
- [ ] `[HomeTabView] Appeared - fetching wallet`
- [ ] `[UserWalletViewModel] fetchWallet() ENTERED`
- [ ] `[UserWalletViewModel] Fetching wallet for userId: <uuid>`
- [ ] `[WalletService] Fetching wallet from: https://api.playoffchallenge.com/api/wallet`
- [ ] `[WalletService] Added Authorization header for userId: <uuid>`
- [ ] `[WalletService] Response status: 200` (or error code)
- [ ] `[WalletService] Decoded wallet: balance_cents=<amount>, ledger_count=<n>`
- [ ] `[UserWalletViewModel] Wallet fetch succeeded: balance=<amount>¢`

**Missing Logs:** _______________________________________________
**Unexpected Logs:** _______________________________________________

**Pass/Fail:** [ ] PASS [ ] FAIL

---

### TEST 8: No Client-Side Wallet Math
**Objective:** Verify client never computes wallet values
**Steps:**
```
1. Search logs for any balance calculations
2. Check that all values come from backend
3. Verify no multiplication of amounts
```

**Expected Behavior:**
- [ ] No logs showing "balance = ..."
- [ ] No logs showing "computed = ..."
- [ ] All values directly from backend response
- [ ] No client-side payout math
- [ ] No entry fee multiplication

**Search for:**
- [ ] Any expression like `balance * entry_count` → should NOT exist
- [ ] Any expression like `amount_cents *` → should NOT exist
- [ ] Any "calculated balance" → should NOT exist

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 9: Error Handling — Network Failure
**Objective:** Verify graceful handling of network errors
**Steps:**
```
1. Turn off WiFi + cellular on test device
2. Navigate to Home tab or refresh wallet
3. Observe error handling
```

**Expected Result:**
- [ ] App doesn't crash
- [ ] Wallet button shows "$0.00" or previous value
- [ ] Error message may appear (optional, handled gracefully)
- [ ] Logs show network error

**Log Verification:**
```
[WalletService] Fetch failed: <network error>
[UserWalletViewModel] Fetch failed: <error description>
```

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

### TEST 10: Sign Out & Re-Sign In
**Objective:** Verify wallet updates correctly on user switch
**Steps:**
```
1. Sign in as User A (with balance)
2. Verify wallet shows User A's balance
3. Sign out
4. Sign in as User B (different balance or no wallet)
5. Navigate to Home tab
6. Verify wallet shows User B's data
```

**Expected Result:**
- [ ] User A balance displays correctly
- [ ] Sign out completes
- [ ] Sign in as User B succeeds
- [ ] Wallet button updates to User B's balance
- [ ] No stale data from User A
- [ ] Correct userId in logs for each user

**User A Balance:** $_______
**User B Balance:** $_______
**Logs Show Different userIds:** [ ] YES [ ] NO

**Pass/Fail:** [ ] PASS [ ] FAIL
**Notes:** _______________________________________________

---

## Summary

### Test Results
| Test | Result | Notes |
|------|--------|-------|
| 1. Endpoint Validation | [ ] PASS [ ] FAIL | |
| 2. Wallet Button Display | [ ] PASS [ ] FAIL | |
| 3. Detail View Navigation | [ ] PASS [ ] FAIL | |
| 4. Pull-to-Refresh | [ ] PASS [ ] FAIL | |
| 5. New User (401) | [ ] PASS [ ] FAIL | |
| 6. No Wallet (404) | [ ] PASS [ ] FAIL | |
| 7. Logging | [ ] PASS [ ] FAIL | |
| 8. No Client Math | [ ] PASS [ ] FAIL | |
| 9. Network Error | [ ] PASS [ ] FAIL | |
| 10. Sign Out/In | [ ] PASS [ ] FAIL | |

### Overall Status
**Total Tests:** 10
**Passed:** ____
**Failed:** ____
**Blockers:** [ ] YES [ ] NO

---

## Staging Note Resolution

### Current Status
The code includes this STAGING NOTE:
```swift
// STAGING NOTE: Backend may return 401 if user has no wallet yet.
// Treat as "no wallet exists" and display $0.00 while backend alignment pending.
// In production, backend should return 404 or { balance_cents: 0 } for new users.
```

### Backend Behavior Confirmed?
- [ ] YES — Backend returns: _________________ (describe actual behavior)
- [ ] NO — Still under investigation

### Can STAGING NOTE Be Removed?
- [ ] YES — Backend behavior confirmed and documented
- [ ] NO — Waiting for: _______________________________________________

### Recommended Action
- [ ] Remove STAGING NOTE from code
- [ ] Update OpenAPI spec with confirmed behavior
- [ ] Keep graceful fallback as production safety net

---

## Defects Found

### Critical
None reported yet.

### High
None reported yet.

### Medium
None reported yet.

### Low
None reported yet.

---

## Sign-Off

**QA Tester:** _______________________________________________
**Date Tested:** _______________________________________________
**Overall Result:** [ ] PASSED [ ] FAILED
**Ready for Production:** [ ] YES [ ] NO

**Sign-Off Comments:**
_______________________________________________
_______________________________________________
_______________________________________________

---

## Next Steps
- [ ] All tests passed → Remove STAGING NOTE
- [ ] Defects found → Create tickets
- [ ] Backend alignment needed → Update OpenAPI
- [ ] Production deployment → Approved

