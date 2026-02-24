# Infrastructure Training Guide — How the System Actually Works

## What This System Is

This platform runs paid fantasy sports contests. Think of it as a referee, cashier, and scorekeeper combined—all automated.

Here's what it does:

1. **Collects money** from players who enter a contest
2. **Verifies payment** through a payment processor (Stripe)
3. **Locks entries** when the contest starts
4. **Ingests game data** to score the entries
5. **Determines winners** based on the scoring rules
6. **Pays winners automatically** without any manual approval
7. **Records everything** so you can see what happened and why

None of these steps require manual intervention. The system moves through them automatically based on timing and data.

---

## The Contest Lifecycle

Every contest follows the same sequence of states. It always follows this path—it never skips steps.

```
SCHEDULED  →  LOCKED  →  LIVE  →  COMPLETE  →  SETTLED  →  PAID
```

### SCHEDULED
The contest exists but hasn't started yet. Players can still enter and pay to join. The system is waiting for the start time.

### LOCKED
The start time has arrived. No more entries are accepted. The system stops collecting money and freezes the player list.

### LIVE
The contest is running. Games are being played. The system is waiting for all games to finish.

### COMPLETE
All games have ended. The system has received the final scores but hasn't calculated winners yet.

### SETTLED
Winners have been calculated. Payout amounts are known. Now the system is waiting to pay them out.

### PAID
Money has been transferred to winners. The contest is closed.

Each state transition happens automatically at the right time. No operator has to move a contest from one state to another. State changes trigger automatically based on:
- Real-world timing (the scheduled start time)
- Game data arrival (scores from the sports provider)
- System timers (payout happens after settlement)

**Why this matters:** Contests can't get stuck between states. They can't skip states. This prevents winners from being paid before the contest is actually complete, and prevents the system from accepting entries after scoring has started.

---

## How Money Flows

Money movement happens in phases. Each phase is separate and automatic.

### Phase 1: Collection
1. Player clicks "Join Contest"
2. Player enters payment information
3. Payment processor (Stripe) validates the card and charges it
4. Player's payment status updates: "Paid"
5. Player becomes an eligible entry in the contest

**What happens if the card is declined?** The player doesn't enter the contest. No entry is created. They're notified and can try again.

### Phase 2: Holding
While the contest is locked and live, the money sits in the Stripe account. It's not sent anywhere. It's held as the "house take" (the platform's commission) and the prize pool combined.

### Phase 3: Settlement
When the contest is complete:
1. Winners are calculated
2. Payout amounts are determined (Stripe transfer amount)
3. A payout job is created in the system
4. The system tells Stripe: "Send $X to each winner"

### Phase 4: Payout
Stripe transfers money to each winner's bank account. The system records:
- When the payout was initiated
- Stripe's confirmation
- Whether it succeeded or failed

### Phase 5: Audit
Everything is logged. You can see:
- Who paid what
- When they paid
- Who won
- How much they won
- When the payout was sent
- Confirmation that Stripe delivered the money

**Key principle:** The system collects money early (Phase 1), but doesn't promise to pay anyone until winners are truly determined (Phase 3). No player is charged until they actually join. No winner is paid until the contest is completely scored.

---

## How We Prevent Double Charges and Double Payouts

Imagine a player joins a contest. The payment succeeds, but the network hiccups and the confirmation gets lost. The player tries to join again. The payment goes through again. Now they're charged twice.

Or imagine a payout is sent to a winner, but before we record it, the system restarts. It sees the unpaid winner and sends the payout again. They're paid twice.

This is prevented by **idempotency**.

### The Concept (Non-Technical Explanation)

Every transaction has a unique fingerprint. That fingerprint is:
- Generated when the transaction is first initiated
- Stored in the system
- Checked every time the transaction might happen again

If the same fingerprint appears twice, the system says: "I've already done this. I won't do it again."

### How It Works in Practice

**Scenario 1: Double Join**
- Player A pays to join Contest X. Fingerprint: "Player A + Contest X + Payment ID 12345"
- Network hiccup. System doesn't get confirmation.
- Player A tries to join again. Same payment ID.
- System checks: "Do I have a record of 'Player A + Contest X + Payment ID 12345'?"
- Answer: Yes.
- Result: Player A is not charged again. They're told they're already in the contest.

**Scenario 2: Double Payout**
- Winner B is paid $500. Fingerprint: "Contest X + Winner B + Payout ID 98765"
- System records it but crashes before updating the ledger.
- System restarts and sees an unpaid winner.
- System checks: "Do I have a record of 'Contest X + Winner B + Payout ID 98765'?"
- Answer: Yes.
- Result: Winner B is not paid again. The ledger is updated to reflect the existing payout.

**Why this matters:** Network failures, system restarts, and retries don't create accidental duplicate transactions. Money only moves once per event, even if the system tries multiple times.

---

## What Makes It "Hands Off"

The system is designed to need almost no manual intervention. Here's why:

### Ingestion is Automatic
Game scores come from the sports provider automatically. The system fetches them, validates them, and ingests them into the contest database. No operator has to manually enter scores.

### Settlement is Deterministic
The scoring rules are defined when the contest is created. Given the same game data, the same winner will always be calculated. There's no randomness. The system doesn't ask for judgment—it follows the rules.

### Payout is Automatic
Once winners are determined, payouts are created and sent to Stripe automatically. No operator reviews a payout list and approves it. The system handles it.

### Logging is Comprehensive
Every action—collection, score ingestion, settlement, payout—is recorded with:
- A timestamp
- What action happened
- Whether it succeeded or failed
- Why it failed (if applicable)

You can see what happened and trace any issue to its root cause.

### No Silent Failures
If something goes wrong—a payment fails, a payout can't be sent, Stripe rejects a transaction—the system records it and alerts. Nothing gets swept under the rug.

### Environment Separation
Testing and production are completely separate. A developer's test run doesn't affect production data. Production failures don't corrupt test data. This prevents accidents.

---

## What Would Cause Operator Intervention

Most contests run without manual intervention. But some issues require human judgment:

### 1. Stripe Account Invalid
If the Stripe account is misconfigured or disabled, payouts fail. An operator would need to fix the account configuration.

### 2. Provider Data Corruption
If game data from the sports provider is incomplete or contradictory, the system can't determine a winner with confidence. An operator might need to manually validate or correct the data.

### 3. Infrastructure Outage
If the database, servers, or network infrastructure fails, the system stops. An operator would need to fix the infrastructure, then the system would resume automatically.

### 4. Database Failure
If data is corrupted or lost, an operator might need to restore from a backup. The system can't fix corrupted data on its own.

### 5. Explicit Admin Action
An operator might manually cancel a contest or adjust settings for legitimate reasons (e.g., a contest glitch was discovered before live data arrived). These are intentional, not error recovery.

**Most issues are automated:** Payment processor errors, network hiccups, retries—all handled by the system without human input.

---

## What This System Does NOT Do

Clear guardrails about what the system intentionally avoids:

### No Manual Payout
Payouts are never created or reviewed manually. The system generates them. An operator can't intercept a payout to tweak the amount or recipient. This prevents favoritism and human error.

### No Dynamic Scoring Engine
Scoring rules are fixed when the contest is created. The system doesn't have a panel of humans scoring entries subjectively. Scoring is algorithmic and deterministic.

### No Hidden Logic
All logic is traceable through code. There's no "magic" behavior that happens behind the scenes. If a player's score changes, you can see exactly why.

### No Environment Hacks
Production data is never modified to "fix" a problem temporarily. Testing code never runs in production. These boundaries are enforced by the system.

### No Tier Logic or Special Cases
All players in a contest follow the same rules. There's no special tier that gets different payout percentages or different scoring. Everyone in a contest plays by the same rules.

### No Lifecycle Mutation from Payment
A player's payment doesn't trigger a scoring change or contest state change. Payment and scoring are separate concerns. One doesn't affect the other.

---

## Key Takeaway

This system is designed for **automation and audit, not intervention and judgment**.

Every dollar is tracked. Every decision is logged. Every state transition is automatic. The operator's job is to monitor, investigate alerts, and fix broken infrastructure—not to manage individual contests or manually move money around.

If the system works, nothing happens. You see contests scheduled, enter locked states, contests complete, winners paid. Then the next contest starts. That's the system doing its job.

If something breaks, the system alerts you with details. You fix it. The system resumes.

That's the model.
