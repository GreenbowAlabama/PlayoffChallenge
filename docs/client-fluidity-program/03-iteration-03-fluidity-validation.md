# Client Fluidity Program
## 03: Iteration 03 - Fluidity Validation

**Status:** PLANNED
**Iteration:** 03
**Duration:** 2-3 weeks
**Owner:** QA/Platform/iOS Team (Joint)
**Depends On:** Iteration 01 + Iteration 02 (Both must close)
**Blocks:** Production Deployment

---

## Purpose

Prove that the fluidity model works end-to-end by introducing a new contest type to staging, validating that iOS renders it without code changes, and confirming that all platform invariants remain intact.

---

## Scope

### In Scope

1. **New Contest Type in Staging**
   - Create a mock contest type distinct from existing types
   - Example: "lightning-round" or "pool-contest"
   - Ensure it uses standard schema (no migrations)

2. **iOS Rendering Validation**
   - Run latest iOS build without code changes
   - Join the new contest type
   - Render contest detail page
   - Render leaderboard with new column schema
   - Render payout table
   - Render roster config and create entry

3. **Leaderboard Adaptation**
   - Verify columns render correctly (unknown types too)
   - Verify sorting hints respected
   - Verify currency formatting correct
   - Verify pagination works

4. **Payout Table Rendering**
   - Verify place ordinals render
   - Verify rank ranges display
   - Verify amounts in currency

5. **Roster Config Rendering**
   - Verify entry fields parse and display
   - Verify constraints shown to user
   - Verify validation rules displayed (not enforced)
   - Verify submission succeeds

6. **Client-Side Scoring Absence**
   - Confirm no scoring logic triggered
   - Confirm no payouts calculated locally
   - Confirm leaderboard data fetched from server only

7. **Platform Invariants Intact**
   - Multi-contest isolation verified
   - Existing contest types still work
   - No schema drift
   - No lifecycle drift

8. **Environment Isolation**
   - All tests run against staging only
   - No production data accessed
   - No environment switching required

### Out of Scope

- **Production Deployment:** Staging validation only; deployment decision separate
- **New Contest Type Features:** Creation/edit admin UI unchanged
- **Performance Testing:** Measured separately if needed
- **Load Testing:** Staging environment only
- **Security Testing:** Defer to security review
- **Accessibility Testing:** Continue per existing standards

---

## Invariants

### Fluidity Invariant
- A new contest type added to staging DB must be renderable in iOS without code or binary change

### Isolation Invariant
- Rendering new contest type does not break existing contests
- Scoring in one contest does not affect another
- Leaderboard data is independently generated per contest

### Contract Invariant
- All data comes from backend contract (iteration-01)
- iOS interprets data, does not compute business logic
- Column schema defines rendering; no fallback logic

### Determinism Invariant
- Leaderboard is deterministic (same data = same display)
- Payout table is deterministic (no randomization)
- Roster validation rules are deterministic

---

## Mandatory Precondition: iOS Binary Sequencing

**The iOS binary must be built and frozen BEFORE the new contest type is introduced in backend.**

**Verification:**
- [ ] Document iOS binary version number and build timestamp
- [ ] Confirm build predates new contest type introduction
- [ ] Tag commit in iOS repo marking binary freeze point
- [ ] Verify no iOS commits occur after binary freeze until validation completes

**Why:** Ensures fluidity is proven independently without coordinated deployment.

---

## Staging Validation Checklist

### Phase 1: New Contest Type Setup

**Database:**
- [ ] Create mock contest type in `contest_types` table (if exists)
  - Example: `{ id: "lightning-round", name: "Lightning Round", description: "Fast-paced challenge" }`

- [ ] Create contest instance with type
  ```sql
  INSERT INTO contest_instances (
    contest_type,
    name,
    description,
    status,
    entry_fee,
    max_entries,
    starts_at,
    ends_at
  ) VALUES (
    'lightning-round',
    'Test Lightning Round',
    'Validation contest for fluidity program',
    'open',
    5.00,
    100,
    NOW(),
    NOW() + INTERVAL '7 days'
  );
  ```

- [ ] Verify schema applies without errors
- [ ] Verify no migration needed

**API Validation:**
- [ ] `GET /api/contests/{new_id}` returns all required fields
  - `type`, `actions`, `payout_table`, `roster_config` all present
- [ ] `GET /api/contests/{new_id}/leaderboard` returns valid schema
  - At least 3 columns defined
  - Column types include: numeric, currency, string
- [ ] Payout table has at least 3 rows
- [ ] Roster config has at least 2 entry fields

**Staging Admin Access:**
- [ ] Admin can view new contest in admin panel
- [ ] Admin can view leaderboard in admin panel
- [ ] No errors in backend logs

### Phase 2: iOS Binary Validation (Frozen Binary Only)

**Verify Frozen Binary:**
- [ ] Confirm iOS binary is the one marked in Precondition above
- [ ] Verify binary version matches documentation
- [ ] Verify build timestamp is BEFORE new contest type introduction

**Deployment:**
- [ ] Deploy frozen binary to internal test device or TestFlight
- [ ] No code changes to iOS after this point (validation phase lock)
- [ ] Deployment succeeds without errors

**Smoke Test:**
- [ ] App launches without crashes
- [ ] User authentication works
- [ ] Can join existing contest type (verify basic flow works)
- [ ] No crashes on startup

**Setup for New Type Testing:**
- [ ] Create test user account in staging
- [ ] Add sufficient staging credits
- [ ] Confirm user can join existing contest types (control verification)

### Phase 3: Join & Render Contest (No iOS Code Changes)

**Join Flow:**
- [ ] Open app in staging
- [ ] Use mock join link or direct contest ID
- [ ] Call `GET /api/custom-contests/join/:token` (or direct contest view)
- [ ] Verify contest detail displays
- [ ] Verify no errors on display
- [ ] Verify all data (name, fee, dates) displays correctly

**Verify No Client-Side Logic:**
- [ ] Leaderboard not shown (contest not scored yet)
- [ ] No scoring progress bar visible
- [ ] No score calculations shown
- [ ] No payout estimates displayed
- [ ] Join button shows: enabled if `can_join=true`

**Render Contest Detail:**
- [ ] Contest name displays
- [ ] Entry fee displays in currency
- [ ] Contest type displays (if UI shows it)
- [ ] Start/end dates display
- [ ] Organizer name displays
- [ ] `actions` object drives UI state (buttons enabled/disabled correctly)

**Action Flag Verification:**
- [ ] `can_join=true` → Join button enabled
- [ ] `can_join=false` → Join button disabled with reason
- [ ] `is_closed=false` → "Join" shows (not "Closed")
- [ ] `is_scoring=false` → Leaderboard not visible yet
- [ ] `is_scored=false` → "Scores not yet calculated" shows

**Render Payout Table:**
- [ ] Table displays with at least 3 rows
- [ ] Place column shows ordinalized (1st, 2nd, 3rd)
- [ ] Rank column shows correctly (single or range)
- [ ] Payout amounts display with currency symbol
- [ ] No errors on render

**Render Roster Config:**
- [ ] Entry fields display based on `entry_fields` array
- [ ] Each field displays name and type hint
- [ ] Constraints displayed (salary cap, player limits, etc.)
- [ ] Required fields marked
- [ ] No errors on render

**Join Contest:**
- [ ] User can click "Join" button
- [ ] Join flow works
- [ ] Confirmation displays
- [ ] Entry created successfully

### Phase 4: Entry Creation & Roster Display (Week 2)

**Create Entry:**
- [ ] Entry creation form displays with fields from `roster_config`
- [ ] All field types render (player_selection, text, etc.)
- [ ] Constraints shown inline (e.g., "Select up to 3 players")
- [ ] Validation rules displayed as text (not enforced)
- [ ] No scoring logic runs during entry creation

**Entry Validation (Client Display Only):**
- [ ] Salary cap shows as user adds players
- [ ] "Salary: $30,000 / $50,000" displays
- [ ] "Add Player" button disables if max reached
- [ ] Validation rules shown (e.g., "Total salary cannot exceed $50,000")
- [ ] User can submit even if displays show "violations" (server is authority)

**Submit Entry:**
- [ ] Entry submits successfully
- [ ] Confirmation displays
- [ ] Entry appears in user's entry list
- [ ] No client-side scoring triggered

### Phase 5: Leaderboard Rendering (Dynamic Schema Only)

**Setup Leaderboard Data:**
- [ ] Backend admin scores contest manually or via script
- [ ] Leaderboard endpoint returns valid data with schema

**Render Leaderboard:**
- [ ] Leaderboard displays on contest detail
- [ ] Columns render dynamically from schema
- [ ] All column types render correctly:
  - [ ] Ordinal (rank 1→"1st")
  - [ ] String (player names)
  - [ ] Numeric (scores with precision)
  - [ ] Currency (payouts with symbol)
  - [ ] Percentage (any % columns)
  - [ ] Date (if present)
  - [ ] Unknown types (default to string)

**Leaderboard Sorting:**
- [ ] Columns sort according to `sort_direction` in schema
- [ ] Descending columns sort high-to-low by default
- [ ] Ascending columns sort low-to-high by default
- [ ] Sorting updates correctly on tap

**Pagination:**
- [ ] Leaderboard shows 25 rows per page by default
- [ ] Page indicator shows current page
- [ ] "Next" button works and loads next page
- [ ] "Previous" button works and loads previous page
- [ ] User row highlighted if in leaderboard

**Leaderboard Performance Baseline:**
- [ ] Measure leaderboard render time (document in report)
- [ ] Measure pagination response time (document in report)
- [ ] No crashes or memory exceptions
- [ ] Performance regression test: new type performs as well as existing types

### Phase 6: Multi-Contest Isolation (Mandatory Verification)

**Setup:**
- [ ] Create/join 2 existing contest types (before new type)
- [ ] Create/join new contest type (lightning-round)
- [ ] Ensure at least one existing contest is scored

**Verify Isolation:**
- [ ] View contest A leaderboard
- [ ] Switch to contest B leaderboard
- [ ] Verify data did not mix (no rows from contest A in B)
- [ ] View contest C (new type) leaderboard
- [ ] Verify no data from A or B appears in C
- [ ] View contest A again → verify no data from C

**Verify State Independence:**
- [ ] Contest A: scored
- [ ] Contest B: open
- [ ] Contest C: open
- [ ] Each shows correct state independently
- [ ] Changing contest A state does not affect B or C

### Phase 7: Regression Testing (All Existing Types)

**Existing Contest Types:**
- [ ] Test with existing contest type (must have at least one)
- [ ] Join existing contest (no new code deployed)
- [ ] Render contest detail
- [ ] Render leaderboard (if scored)
- [ ] Verify all rendering works as before
- [ ] Verify no regression from changes

**Core Features:**
- [ ] User login/auth works
- [ ] Multiple contests in user's list
- [ ] Contest search/filter works
- [ ] Navigation between contests works
- [ ] User profile displays correctly
- [ ] Entry history displays correctly

**API Contracts:**
- [ ] All existing endpoints still return correct data
- [ ] New endpoints (`/leaderboard`) working
- [ ] Error responses correct format
- [ ] Rate limiting not exceeded

---

## Manual Exploratory Testing Protocol (Required)

**Scope:** Free-form testing to find edge cases and unexpected behavior

**Testers:** 2-3 QA + 1 iOS dev
**Closure Gate Requirement:** Zero blocker-severity issues found

**Scenarios to Explore:**

1. **Edge Cases in Leaderboard:**
   - Contest with only 1 participant
   - Contest with 100+ participants (pagination)
   - Leaderboard with ties (same score/payout)
   - Very large numbers (payout $1,000,000)
   - Very small numbers (payout $0.01)
   - Negative numbers (if applicable)

2. **Edge Cases in Roster Config:**
   - Entry field with very long name (100+ chars)
   - Very long validation rule message
   - Maximum number of entry fields
   - Required field with no options
   - Constraint that cannot be satisfied

3. **UI Edge Cases:**
   - Very long contest name
   - Very long contest description
   - Unicode in names (emojis, accents)
   - Missing optional fields in API response
   - Empty leaderboard (no participants scored)

4. **State Transitions:**
   - Join, then view leaderboard before scoring
   - Join, contest gets scored, refresh leaderboard
   - Contest state changes (open → closed) while viewing
   - User rank changes as other entries score

5. **Network Edge Cases:**
   - Slow network (>5 second leaderboard load)
   - Network timeout during entry submission
   - Network timeout during join
   - Retry after network failure
   - Airplane mode toggle

6. **Device Edge Cases:**
   - Small screen (iPhone SE)
   - Large screen (iPad)
   - Landscape orientation
   - Device rotation during load
   - App backgrounding/foregrounding

**Documentation:**
- [ ] Record findings in spreadsheet or ticket system
- [ ] Screenshot anomalies
- [ ] Note reproducibility (always, sometimes, once)
- [ ] Prioritize by severity and frequency

---

## TestFlight Validation Checklist (If Required)

**Pre-TestFlight:**
- [ ] Build is release candidate (no debug symbols)
- [ ] Beta distribution certificate valid
- [ ] Privacy policy linked
- [ ] Release notes written: "Testing new contest type fluidity"

**TestFlight Deployment:**
- [ ] Binary uploaded to App Store Connect
- [ ] Build processed successfully
- [ ] No crash reports in metadata
- [ ] Testers invited
- [ ] All testers can access build

**TestFlight Testing:**
- [ ] App launches without crash
- [ ] No crashes reported during testing
- [ ] Tester can join new contest type
- [ ] Tester can view contest detail
- [ ] Tester can view leaderboard
- [ ] All rendering works as expected

**Closure Gate Requirements (Binary):**
- [ ] Zero crashes reported in TestFlight
- [ ] Zero blocking issues reported
- [ ] All critical flows work correctly
- [ ] No UI anomalies requiring immediate fix

---

## Regression Checklist

### Core Platform Functionality

- [ ] User can create account
- [ ] User can log in
- [ ] User can view contest list
- [ ] User can search/filter contests
- [ ] User can join multiple contests
- [ ] User can create entries in multiple contests
- [ ] User can view entry history
- [ ] User can view account settings
- [ ] User can update profile

### Contest Lifecycle

- [ ] Open contest can be joined
- [ ] Closed contest cannot be joined
- [ ] Scoring status displays correctly
- [ ] Leaderboard shows when scored
- [ ] Entries locked when contest closes
- [ ] Payouts calculated correctly (server-side)
- [ ] User can view their final standing

### Existing Contest Types

- [ ] Each existing contest type renders in list
- [ ] Each can be joined
- [ ] Each displays detail page correctly
- [ ] Each displays leaderboard correctly
- [ ] None are affected by new type

### API Response Integrity

- [ ] Contest list returns all contests
- [ ] Contest detail includes all required fields
- [ ] Leaderboard endpoint returns valid schema
- [ ] Payout table matches leaderboard payouts
- [ ] Roster config validates against schema

### Performance (Baseline Measurement & Regression Test)

- [ ] Measure and document: Contest list load time
- [ ] Measure and document: Contest detail load time
- [ ] Measure and document: Leaderboard load time per page
- [ ] Measure and document: Entry creation time
- [ ] Measure and document: Join flow time
- [ ] Regression test: New type performs comparably to existing types
- [ ] No memory leaks detected after 30 minutes of usage

### Network Resilience

- [ ] Retry on timeout works
- [ ] Offline mode degrades gracefully
- [ ] Refresh button updates data
- [ ] No stale data displayed after refresh

---

## Closure Gate: Binary Definition of "Fluidity Achieved"

**Fluidity is achieved ONLY when ALL conditions are met:**

### Preconditions Met
- [ ] iOS binary documented and confirmed to predate new contest type introduction
- [ ] iOS repository shows no commits during validation phase

### New Contest Type Onboarded (Backend-Only)
- [ ] New type exists in staging database
- [ ] No schema migrations required
- [ ] No backend code changes required (uses existing schema)
- [ ] API contract verified: `type`, `actions`, `payout_table`, `roster_config` all present

### iOS Renders Without Code Changes (Frozen Binary Proof)
- [ ] Frozen iOS binary renders new contest type correctly
- [ ] No iOS code changes required
- [ ] No iOS binary rebuild required
- [ ] No TestFlight submission required
- [ ] No App Store update required

### All Rendering Adapts Dynamically (Schema-Driven)
- [ ] Leaderboard columns render exactly from `column_schema`
- [ ] Payout table renders exactly from `payout_table` array
- [ ] Roster config renders exactly from `roster_config` schema
- [ ] Unknown field types handled gracefully (default rendering)
- [ ] No fallback logic or hardcoded assumptions

### Zero Client-Side Business Logic (Codebase Audit)
- [ ] Codebase audit confirms: no scoring logic triggered
- [ ] Codebase audit confirms: no payout calculations performed
- [ ] Codebase audit confirms: no state prediction attempted
- [ ] Leaderboard data fetched from server (not computed locally)
- [ ] All validation rules are informational (server authoritative)

### Platform Invariants Preserved (Testing Verification)
- [ ] Multi-contest isolation verified: contest A/B/C data never mixed
- [ ] Existing contest types still work (regression tests pass)
- [ ] No schema drift: database schema unchanged
- [ ] No lifecycle drift: state machine unchanged
- [ ] Rendering deterministic: same data always produces same display

### Quality Gates (All Pass/Fail Binary)
- [ ] All staging validation phases completed: zero skipped checklist items
- [ ] All columns render correctly: ordinal, numeric, currency, string, percentage, date
- [ ] All regression tests pass: zero failures
- [ ] Zero crashes in TestFlight (if performed)
- [ ] Zero blocker-severity defects found
- [ ] Manual exploratory testing: only minor/non-blocking issues (if any)
- [ ] Architecture review passed: no business logic in iOS

### Sign-Off Obtained
- [ ] QA Lead approval
- [ ] iOS Lead approval
- [ ] Backend Lead approval
- [ ] Platform Architecture approval
- [ ] Product Manager approval

### If Closure Gate Passed (Fluidity Achieved)
- [ ] Document validation results
- [ ] Document lessons learned
- [ ] Update platform architecture documentation
- [ ] Plan production rollout (separate from iOS binary deployment)
- [ ] Onboard additional contest types using same process

### If Closure Gate Failed (Fluidity Not Achieved)
- [ ] Document all failures and blocking issues
- [ ] Create action items for each failure
- [ ] Determine: re-test, iteration fix, or re-plan
- [ ] Root cause analysis
- [ ] Update process/documentation if needed

---

## Program Success Criteria

**All 3 Iterations Must Close with Zero Blocker Defects**

| Iteration | Success Definition |
|-----------|------------------|
| 01: Backend | Contract fully specified, tested, no breaking changes |
| 02: iOS | Business logic removed, rendering fully dynamic, all tests pass |
| 03: Validation | New type renders without iOS changes, all gates pass, zero blockers |

**When All 3 Close: Fluidity Enabled = Can onboard new contest types to production without iOS releases.**

---

## Sign-Off

- [ ] QA Lead Approval
- [ ] iOS Lead Approval
- [ ] Backend Lead Approval
- [ ] Platform Architecture Approval
- [ ] Product Manager Approval (fluidity achieved)
- [ ] Ready for Production Rollout

---

## Appendix: New Contest Type Specification (Backend-Only Configuration)

**CRITICAL:** The following configuration is backend-only and is NOT part of the Presentation Contract. iOS must not receive or interpret any of these scoring rules.

```json
{
  "type": "lightning-round",
  "name": "Lightning Round",
  "description": "Fast-paced challenge with rapid-fire picks",
  "scoring_rules": {
    "correct_pick_bonus": 10,
    "speed_bonus": 2,
    "streak_multiplier": 1.5
  },
  "entry_format": {
    "max_picks": 5,
    "time_limit_seconds": 30,
    "pick_type": "sequential"
  },
  "payout_distribution": {
    "top_10_percent": 0.50,
    "top_25_percent": 0.30,
    "top_50_percent": 0.20
  }
}
```

**Backend Responsibility:**
- This configuration determines how scores are calculated
- This configuration determines how payouts are distributed
- Backend exposes ONLY the final scores and payout amounts to iOS (not the rules)

**iOS Responsibility:**
- iOS receives `leaderboard` with computed scores (not rules)
- iOS receives `payout_table` with final amounts (not distribution logic)
- iOS renders data as-is; does not interpret or apply scoring rules
- Unknown contest types render with default styling; iOS requires NO changes

**Validation Requirement:**
- Confirm iOS binary makes zero calls or references to any scoring_rules, entry_format, or payout_distribution objects
- All iOS interactions with new type use standard presentation contract only
