# Web Admin Operational Map
Playoff Challenge Platform

**Status:** AUTHORITATIVE
**Purpose:** Map operational issues to correct Web-Admin locations. Prevent AI hallucination of UI paths.

**Critical Rule:** Workers must not invent admin navigation paths. If the UI structure changes, this document must be updated.

---

# Troubleshooting Rule

All operational diagnostics follow this order:

1. Web-Admin UI
2. Admin API
3. Logs
4. SQL (last resort)

Workers must always guide operators through Web-Admin first.

---

# Finance

## Wallet Balance Mismatch

**Admin Area:**
Finance

**Primary Page:**
Financial Ops

**Verify:**
- wallet liability
- contest pool totals
- total deposits
- total withdrawals

**Fallback Page:**
Funding

**Additional Checks:**
- recent ledger entries
- failed deposit attempts
- pending withdrawals

---

## Deposit Problems

**Admin Area:**
Finance

**Primary Page:**
Funding

**Verify:**
- deposit attempts
- Stripe payment status
- funding success/failure logs

**Fallback Page:**
Financial Ops

---

## Withdrawal Issues

**Admin Area:**
Finance

**Primary Page:**
Financial Ops

**Verify:**
- withdrawal requests
- wallet balance
- payout status

**Fallback Page:**
Funding

---

# Contests

## Contest Stuck in Incorrect State

**Admin Area:**
Contests

**Primary Page:**
Contest Instances

**Verify:**
- contest status
- lifecycle transition history
- lock_time
- tournament_start_time

**Fallback Page:**
Contest Templates

---

## Contest Not Appearing for Users

**Admin Area:**
Contests

**Primary Page:**
Contest Templates

**Verify:**
- template enabled
- template visibility
- template configuration

**Fallback Page:**
Contest Instances

**Verify:**
- contest status
- lock time
- capacity

---

## Contest Capacity Problems

**Admin Area:**
Contests

**Primary Page:**
Contest Instances

**Verify:**
- participant count
- max capacity
- entry fee

---

# Discovery System

## Tournament Discovery Failure

**Admin Area:**
Discovery

**Primary Page:**
Tournament Sync

**Verify:**
- provider_tournament_id
- last discovery run
- tournament metadata
- instance creation results

**Fallback Page:**
Discovery Logs

---

## Contest Instances Not Generated

**Admin Area:**
Discovery

**Primary Page:**
Tournament Sync

**Verify:**
- template creation
- instance creation
- discovery cycle success

---

# Player Data

## Player Ingestion Failure

**Admin Area:**
Discovery

**Primary Page:**
Player Ingestion

**Verify:**
- ingestion progress
- total players imported
- ingestion errors

**Fallback Page:**
Discovery Logs

---

## Leaderboard Not Updating

**Admin Area:**
Operations

**Primary Page:**
Leaderboards

**Verify:**
- active PGA leaderboard data
- latest score ingestion time
- player scoring updates
- leaderboard entry count

**Fallback Page:**
Discovery → Player Ingestion

---

# Settlement

## Contest Settlement Failure

**Admin Area:**
Finance

**Primary Page:**
Financial Ops

**Verify:**
- contest pool balance
- payout entries
- settlement status

**Fallback Page:**
Contests → Completed Contests

---

## Missing Prize Payouts

**Admin Area:**
Finance

**Primary Page:**
Financial Ops

**Verify:**
- payout ledger entries
- user wallet credits

**Fallback Page:**
Contests → Completed

---

# Discovery & Lifecycle

## Contest Did Not Lock

**Admin Area:**
Contests

**Primary Page:**
Contest Instances

**Verify:**
- lock_time
- contest status
- lifecycle transitions

---

## Contest Did Not Go Live

**Admin Area:**
Contests

**Primary Page:**
Contest Instances

**Verify:**
- tournament_start_time
- status transitions
- ingestion start time

---

# AI Worker Troubleshooting Format

When assisting an operator, always guide them using this format:

**Step 1**
Open Web Admin

**Step 2**
Navigate to:

[Admin Area] → [Page Name]

**Step 3**
Return the following values:

- [value 1]
- [value 2]
- [value 3]

**Step 4**
Paste the values here for analysis.

---

# SQL Escalation

SQL queries are diagnostic escalation.

Workers must only suggest SQL if:

- the data is not visible in Web-Admin
- the Admin API cannot expose it
- logs do not reveal the issue

**SQL must never be the first troubleshooting step.**

When escalation to SQL is necessary, provide:

- Clear SQL with comments
- What the query reveals
- How to interpret the output
- Next troubleshooting steps
