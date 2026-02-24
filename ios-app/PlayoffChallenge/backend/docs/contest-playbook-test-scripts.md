# Contest Playbook – User Flow Test Scripts

This document defines the expected **user-visible behavior** of the iOS app
for validating new contest types.

These are not architectural tests.
These are user experience validation scripts.

---

# 1. Login Flow

## Objective
User can authenticate and reach the home screen.

## Steps
1. Open the app
2. Log in with valid credentials

## Expected Result
- User lands on the Home screen
- No spinner remains stuck
- No crash
- No empty state confusion
- App feels stable and responsive

---

# 2. Available Contests List

## Objective
User can see all available contests.

## Steps
1. From Home, tap "Available Contests"

## Expected Result
User sees a list of contests.

Each contest card displays:
- Contest Name
- Entry Fee
- Prize Pool
- Status (Scheduled, Live, Complete)

If no contests exist:
- A clear empty state message is shown
- No blank screen

User should feel:
"This is organized and clear."

---

# 3. Scheduled Contest Detail

## Objective
User understands the contest before joining.

## Steps
1. Tap a contest with status = Scheduled

## Expected Result
User sees:
- Contest description
- Entry fee
- Prize pool
- Prize distribution rules
- Join button

If user taps Join:
- Join confirmation occurs
- Join button updates or disables
- User cannot join twice
- No duplicate entries created

User should feel:
"I understand what I’m paying and what I can win."

---

# 4. Live Contest View

## Objective
User can track competition in progress.

## Steps
1. Tap a contest with status = Live

## Expected Result
User sees:
- Leaderboard
- Rankings
- Scores

User should NOT see final payout amounts yet.

User should feel:
"I am actively competing."

---

# 5. Completed Contest View

## Objective
User sees final results and payouts.

## Steps
1. Tap a contest with status = Complete

## Expected Result
User sees:
- Final leaderboard
- Final ranks
- Payout amounts

Validation:
- Total payouts equal prize pool
- Ties are handled correctly
- No missing winners
- No rounding errors visible

User should feel:
"The results are correct and trustworthy."

---

# 6. Settlement Engine Validation

For a completed contest:

- Winner Take All:
  - Rank 1 receives full prize pool
  - Ties split evenly

- Top N Split:
  - Payout percentages match configuration
  - Tied ranks split combined percentage evenly
  - Total payout = 100% of prize pool

All settlement outcomes must be deterministic.

---

# Acceptance Criteria for New Contest Type

Before releasing a new contest type:

- User can understand rules clearly
- Entry fee and payout logic are transparent
- Contest lifecycle transitions correctly:
  Scheduled → Locked → Live → Complete
- Settlement matches documented payout structure
- No UI ambiguity
- No silent failures

If all above pass, contest type is eligible for release validation.

