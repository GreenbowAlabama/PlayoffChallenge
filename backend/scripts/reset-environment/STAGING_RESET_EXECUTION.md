# Staging Environment Reset Execution Guide

**=============================================================================**
**STAGING ONLY. DESTRUCTIVE. NOT A PRODUCTION REPAIR PROCEDURE.**
**=============================================================================**

**GOVERNANCE EXCEPTION:**
This is an ENVIRONMENT REBUILD for staging only. It is a destructive wipe intended to restore the environment to a deterministic "Day 0" state.
This script **MUST NOT** be used for financial repairs in production or staging. Normal financial repairs must use compensating ledger entries as per: `/Users/iancarter/Documents/workspace/playoff-challenge/docs/governance/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md`

---

## Phase 1: Preparation & Stop Execution

1. **Backup Staging DB:** Take a snapshot/backup of the staging database before proceeding. Ensure the operator verifies the backup exists.
2. **Stop All Workers:** Down all services and workers (Ingestion, Discovery, Lifecycle, Payouts, Reconciler). Keep them down through the purge, Stripe wipe, verification, and reseed phases.
3. **Verify Schema:** Run a check to ensure your staging database schema matches the snapshot exactly: `/Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql` and that no unexpected duplicate indexes/constraints exist.

---

## Phase 2: Database Purge

Execute the deterministic purge script. This will clear all historical data, reset identity counters, and preserve exactly **one** canonical system user (`00000000-0000-0000-0000-000000000000`).

**Command:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_staging=YES -f /Users/iancarter/Documents/workspace/playoff-challenge/backend/scripts/reset-environment/reset-db.psql
```
*Note: The script runs inside a single transaction and contains hard assertions. It will abort and roll back automatically if post-purge state or financial invariants (wallet liability, contest pools, drift) are not strictly 0.*

**Expected Post-Purge Verification (Asserted in SQL):**
* `users` = 1 (Only canonical system user)
* `ledger`, `contest_instances`, `contest_participants`, `contest_state_transitions` = 0
* `payout_requests`, `payout_jobs`, `payout_transfers` = 0
* `wallet_withdrawals`, `payment_intents`, `wallet_deposit_intents` = 0
* `stripe_events`, `stripe_webhook_dead_letters` = 0
* `settlement_records`, `settlement_audit`, `settlement_consumption` = 0
* Financial formulas compute `wallet_liability=0`, `contest_pools=0`, `deposits=0`, `withdrawals=0`, `reconciliation_drift=0`.
* Expected retained reference data (`contest_templates`, `game_settings`, `scoring_rules`, etc.) remain intact.

---

## Phase 3: Stripe Reset

Clear the Stripe test environment manually via the dashboard.

1. Log in to the [Stripe Dashboard](https://dashboard.stripe.com/). Ensure **Test Mode** is ON.
2. Navigate to **Developers** -> **Test Data** (or **Settings** > **Data** > **Delete all test data**).
3. Delete all test data, ensuring:
   - PaymentIntents / Charges = 0
   - Payouts / Transfers = 0
   - Customers = 0
   - Connect Accounts = 0 (if created during testing)

---

## Phase 4: Reseed & Discovery

**Architectural Fix Required Before Running:**
There is a known inconsistency: the scripts `seedUpcomingPGAContestsFull.js` and `resetPlayersPlatformContests.js` use the legacy system ID `000...43`.
To ensure clean ownership, **you must update the `PLATFORM_SYSTEM_USER_ID`** in the chosen authoritative script to match the canonical system user: `00000000-0000-0000-0000-000000000000`.

Using `seedUpcomingPGAContestsFull.js` as the authoritative reseed path:
1. Update `PLATFORM_SYSTEM_USER_ID` in `seedUpcomingPGAContestsFull.js` to `00000000-0000-0000-0000-000000000000`.
2. Run the script:
```bash
node /Users/iancarter/Documents/workspace/playoff-challenge/backend/scripts/seedUpcomingPGAContestsFull.js
```
3. **Verify Reseed:**
   - `contest_templates` are present as expected.
   - New `contest_instances` created as expected.
   - `organizer_id` / `is_platform_owned` / `is_system_generated` are correctly assigned to the canonical system user.
   - `contest_participants` = 0.
   - `ledger` = 0.

---

## Phase 5: Worker Restart

Once the environment passes all reseed verifications:
1. Restart the core API services.
2. Restart workers in a controlled order: Discovery -> Ingestion -> Lifecycle -> Financial Reconciler -> Payouts.

---

## Phase 6: Wallet Flow Verification (QA)

Execute these manual QA steps to verify deterministic operations. **Use the approved admin/mint path if available to fund the wallet. Do not hand-write raw ledger rows as the default QA procedure unless there is no governed alternative.**

### Positive Flow
1. **Create Test User:** Sign up as a new user. Wallet balance should be **$0.00**.
2. **Fund Wallet:** Use the approved UI/API admin minting path to add funds.
3. **Join Contest:** Enter a newly discovered contest.
4. **Audit Join (Required Checks):**
   - Exactly **1** `contest_participants` row exists for that user/contest.
   - Exactly **1** `ENTRY_FEE` `DEBIT` row exists in the `ledger` with deterministic/idempotent semantics.
   - Wallet balance equals deposit minus entry fee (computed via aggregate SUM).
   - Contest pool increased by exactly the entry fee amount.
   - Re-attempting the join via API produces **no duplicate debit** (idempotency verified).

### Negative Test Flow
1. **Attempt Join w/ Insufficient Funds:** With a remaining wallet balance lower than a contest's entry fee, attempt to join it.
2. **Audit Rejection (Required Checks):**
   - Verify clean API rejection (`INSUFFICIENT_WALLET_FUNDS`).
   - Verify **no** `contest_participants` row was inserted.
   - Verify **no** `ENTRY_FEE` ledger row was inserted.
