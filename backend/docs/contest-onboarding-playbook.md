# Contest Type Onboarding Playbook

## Overview

This playbook defines how to safely introduce new contest types into the platform. It exists to protect both the platform and the business from the silent failures that come when new logic bleeds into core infrastructure.

A new contest type is not a feature. It is an expansion of the platform's capability surface. Expansions require gates.

---

## Preconditions: Platform Stability First

Before any new contest type enters development:

**The platform must be stable.** This means:

- Settlement logic for all existing contests is deterministic and proven
- Payout execution is automatic with no manual intervention required
- All active contracts (API signatures, database schemas, event contracts) are frozen
- No open invariants have been violated in the last release cycle
- All previously shipped contest types operate independently without cross-contest interference

**Why this matters:** Expanding the platform on unstable ground creates compound risk. A new contest type will inherit every bug in the foundation it stands on. If settlement is flaky or payouts require manual steps, those defects will now apply to the new type as well. This creates the illusion of progress while actually multiplying failure modes.

**Owner:** Product and Engineering Leadership
**Decision:** Written sign-off confirming stable state before design begins

---

## Phase 1: Design — Define the Contest in Full

**Weight:** Fibonacci 8
**Duration estimate:** 1 week
**Constraint:** No code, no implementation

The design phase is where assumptions crystallize into specifications. It is where "this shouldn't be too hard" collides with reality.

### Design Deliverable

Create one design document that covers:

#### Scoring Model
- Define the deterministic algorithm that produces a winner
- Document all inputs (player stats, weather, handicaps, adjustments, etc.)
- Specify how ties are broken
- Specify what data sources feed the algorithm
- Prove the algorithm is idempotent: running it twice on the same inputs produces the same result

#### Ingestion Requirements
- What external data feeds this contest type?
- How frequently must data arrive?
- What schema does inbound data follow?
- Who is responsible for data quality?
- What happens if data arrives late or malformed?

#### Roster Rules
- How many positions are in a roster?
- What constraints govern roster construction (salary caps, position limits, etc.)?
- When does roster lock occur?
- Can rosters be modified after lock?
- What validation errors should reject a roster?

#### Payout Structure
- How is prize pool distributed among winners?
- What is the calculation formula for payouts?
- Are payouts tiered or shared?
- Does the formula work for any prize pool size?
- What edge cases exist (e.g., fewer entries than prize tiers)?

#### Failure Cases
- What happens if scoring data never arrives?
- What happens if data arrives but is incomplete?
- What happens if a participant withdraws?
- What happens if the contest is cancelled mid-flight?
- How are funds returned in each case?

#### Invariants
- Document all invariants this contest type must maintain
- How does it enforce single-contest isolation?
- How does it prevent scoring side effects in other contests?
- What happens if two contests run the same scoring logic concurrently?

#### Lifecycle Confirmation
- Confirm: No changes to contest state machine required
- Confirm: No new transitions needed
- Confirm: Existing lifecycle (draft → open → locked → settled → closed) accommodates this type
- If either is false, stop and reassess design

#### Payment Rule Confirmation
- Confirm: Existing payout execution engine handles this type
- Confirm: No new payment logic required
- Confirm: Automatic settlement works unchanged
- If any is false, stop and reassess design

### Design Non-Goals

List what this contest type does **not** do. This is as important as what it does.

Examples:
- Does not support live scoring
- Does not support mid-contest entry changes
- Does not support custom scoring by user
- Does not require real-time data feeds

Explicit non-goals protect against scope creep and feature bloat.

### Design Sign-Off

Design is complete when:
- All sections above are filled in
- All failure cases have a documented response
- No section contains the phrase "we'll figure that out later"
- Engineering and Product have both signed the document

---

## Phase 2: Implementation — Isolate the Logic

**Weight:** Fibonacci 5
**Duration estimate:** 3-5 days
**Constraint:** No infrastructure changes

Implementation is the act of writing code that satisfies the design. It is not redesign. It is not "let's add this feature too."

### Implementation Rules

#### Scoring Logic Must Be Isolated
- All scoring logic lives in a single, testable function
- That function takes structured input and produces structured output
- It has no side effects
- It makes no database calls
- It calls no external services
- It can be called a thousand times on the same data and produce the same result each time

#### Validation Logic Lives at Contest Layer Only
- Validate roster construction against this type's rules
- Validate payout calculations
- Do not add validation to the platform core
- Do not add validation to settlement
- Do not add validation to payout

#### Infrastructure Remains Untouched
- No changes to contest lifecycle
- No changes to state machine
- No changes to participant join logic
- No changes to settlement engine
- No changes to payout execution
- No changes to database schema (outside of contest-type-specific tables)
- No changes to API contracts

#### Stop If Infrastructure Changes Appear Necessary
If, during implementation, you discover that the design requires changes to:
- How contests transition between states, OR
- How participants are managed, OR
- How settlement works, OR
- How payouts are calculated or distributed

**Stop immediately.** Return to Phase 1. The design was wrong. Infrastructure changes are off-limits for contest type expansion.

### Implementation Sign-Off

Implementation is complete when:
- Code compiles and lints
- All functions are isolated and testable
- No infrastructure changes have been made
- No new database tables unless documented in design
- Scoring logic passes local unit tests

---

## Phase 3: Testing — Prove Determinism and Replay

**Weight:** Fibonacci 13
**Duration estimate:** 1-2 weeks
**Constraint:** Testing costs more than code

Testing is not quality assurance. Testing is proof that the system works as designed under all conditions.

### Test Categories

#### Determinism Tests
- Run the scoring algorithm 100 times with identical inputs
- Verify all 100 runs produce identical outputs
- This proves the algorithm is deterministic

#### Replay Tests
- Create a contest
- Simulate a full contest lifecycle (entries, roster lock, scoring)
- Run scoring
- Record all state
- Clear computed state from the database
- Run scoring again
- Verify all state is identical to first run
- This proves scoring is repeatable without side effects

#### Failure Mode Tests
- Test: Scoring data never arrives
- Test: Scoring data arrives incomplete
- Test: Multiple entries claim the same player
- Test: Participant rosters violate stated constraints
- Test: Prize pool is zero or negative
- Test: More winners than prize tiers
- Verify each failure mode produces predictable, documented behavior

#### Payout Validation Tests
- Generate 10 different prize pools (small, medium, large)
- For each prize pool, generate 10 different participant counts
- Verify payout formula produces valid distributions (non-negative, sums to pool)
- Verify payout formula handles edge cases (1 entry, 1000 entries, ties)
- This proves payouts are mathematically sound

#### End-to-End Tests
- Create a real contest (or production simulation)
- Add entries with real rosters
- Lock the contest
- Wait for scoring data
- Execute settlement
- Verify participants received correct payouts
- Verify contest reached final state
- This proves the full pipeline works

#### Idempotency Confirmation
- Create a contest and score it completely
- Manually trigger scoring again
- Verify no duplicate payouts
- Verify no double-settled state
- This proves scoring creates no side effects on replay

#### Snapshot Verification
- Capture complete contest state at critical moments: open, locked, settled, closed
- Document what the state should be at each moment
- Build automated checks that verify snapshots match expectations
- This becomes a living regression test

### Why Testing Costs More Than Coding

The code implements one path. Testing explores all paths. Determinism testing runs the code hundreds of times. Replay testing runs the full system twice. Failure mode testing intentionally breaks things. This is not waste. This is insurance.

Contests handle money. Money requires proof, not promises.

### Testing Sign-Off

Testing is complete when:
- All test categories above have automated tests
- All tests pass consistently
- No test skips, mocks, or stubs scoring logic
- Determinism and replay are proven, not assumed
- One engineer can independently verify all tests pass

---

## Red Flags: Do Not Ship If These Are True

Stop development and return to design if any of the following is true:

- **Requires lifecycle mutation** — The contest type needs new states or transitions
- **Requires payment logic change** — The contest type needs custom payout rules
- **Requires settlement mutation** — The contest type needs new settlement logic
- **Introduces new state** — The contest type creates data that doesn't fit existing schemas
- **Requires manual payout** — Any prize distribution requires human intervention
- **Introduces optional ambiguity** — Scoring rules could be interpreted multiple ways
- **Depends on external real-time data** — Scoring cannot complete without live feeds
- **Creates cross-contest interference** — Running two instances affects each other

Any of these signals that the design was wrong. Redesign rather than ship.

---

## Definition of Done: Production Ready

**Note:** This section defines readiness for a single NEW contest type, not platform GA readiness. See CLAUDE_RULES.md Section 17 (System Maturity Matrix) for platform-level definitions.

A contest type is production ready if and only if all of the following are true:

#### Platform Invariants Held
- Every invariant documented in the platform remains unviolated
- Single-contest isolation is proven
- No cross-contest side effects exist
- Concurrent contests do not interfere

#### No New Side-Effect Surfaces
- Scoring creates no mutations outside the contest
- Settlement creates no side effects
- Payout creates no unexpected database changes
- Logging and monitoring report only expected events

#### Automatic Payout Works Unchanged
- Existing payout infrastructure handles this contest type
- No new payment service integrations required
- No new payment logic added to platform
- Payouts execute on the normal schedule

#### No New Environment Complexity
- No new environment variables required
- No new services required
- No new data feeds required
- Existing deployment process works unchanged

#### Infrastructure Contract Untouched
- API signatures unchanged
- Database schema frozen (except contest-type-specific tables)
- Event schemas unchanged
- State machine unchanged

#### Sign-Off Ready
- Engineering lead has reviewed all code
- Product lead has verified design compliance
- QA lead has verified all tests pass
- One sentence summary exists explaining what problem this contest type solves

---

## Governance

**Owner:** Product and Engineering Leadership
**Frequency:** Once per new contest type
**Escalation:** If any phase is incomplete, the type does not ship

This playbook is not bureaucracy. It is risk management. Each phase exists because skipping it has burned time or broken production.

New contest types are how the platform grows. This playbook is how growth stays safe.
