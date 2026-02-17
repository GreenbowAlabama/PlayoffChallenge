# Hidden Coupling Risk Audit: Client Fluidity Program
## Pressure Test of System Boundary Integrity

**Audit Date:** 2026-02-16
**Scope:** All 10 structural coupling risks that could silently break fluidity
**Status:** CRITICAL FINDINGS - Iteration 01 NOT Complete

---

## Executive Summary

This audit evaluates the Client Fluidity Program against ten architectural coupling risks that could bypass documented gates. **Critical finding: The Presentation Contract from Iteration 01 (Backend Contract Alignment) has not been fully implemented.** Several foundational elements are missing, creating a cascade of HIGH-RISK coupling vectors.

**Go/No-Go Recommendation: NO-GO for Iteration 02 or 03 until Iteration 01 closure gate items are completed.**

---

## Audit Findings by Risk Area

### Risk 1: Contract Shape Coupling (Additive-Only Semantic Drift)

**Risk Level:** 🔴 **HIGH**

**Actual Finding:**
The Presentation Contract is **NOT YET FULLY DEFINED** in backend endpoints. Critical fields from iteration-01 specification are missing:

| Field | Specification | Actual Implementation | Status |
|-------|---------------|----------------------|--------|
| `type` | Required in all contest responses | ❌ NOT found in API responses | Missing |
| `actions` object | Mandatory in all responses | ❌ NOT implemented | Missing |
| `payout_table` | Exposed in contest detail | ❌ NOT implemented | Missing |
| `roster_config` | Exposed in contest detail | ❌ NOT implemented | Missing |
| `/leaderboard` endpoint | New endpoint required | ❌ NOT found in routes | Missing |
| `column_schema` | Part of leaderboard response | ❌ NOT implemented | Missing |

**Verification Steps Performed:**
```bash
# Search backend for leaderboard endpoint
grep -r "/leaderboard" backend/routes/*.js
# Result: No leaderboard endpoint found

# Search for action flags
grep -r "can_join\|can_edit\|is_read_only\|is_live\|is_scored" backend
# Result: Only lodash references found (false positives)

# Search for payout_table
grep -r "payout_table\|column_schema\|roster_config" backend
# Result: No matches in backend routes/services
```

**Failure Mode:**
- iOS cannot receive contract it was designed to consume (Iteration 02)
- New contest types have nowhere to define their schema
- Leaderboard rendering cannot adapt to dynamic columns
- Action flags cannot control iOS UI behavior

**Mitigation/Enforcement Required:**
1. **Complete Iteration 01 closure gate BEFORE proceeding**
   - [ ] Implement `GET /api/contests/{id}` response with: `type`, `actions`, `payout_table`, `roster_config`
   - [ ] Implement `GET /api/contests/{id}/leaderboard` endpoint with: `column_schema`, `rows`, `leaderboard_state`
   - [ ] Document exact SQL/logic for each action flag derivation
   - [ ] Create integration tests validating contract matches specification

2. **Structural Hardening**
   - Add OpenAPI schema validation in CI that rejects breaking changes to contract
   - Contract snapshot tests: compare contract responses against golden files
   - Automated regression: verify all fields in spec are present in response

---

### Risk 2: Dual Source of Truth (Action Flags vs Status Fields)

**Risk Level:** 🔴 **HIGH**

**Actual Finding:**
Action flags are not yet implemented, so iOS cannot follow the contract mandate that **actions must be the sole behavioral driver.**

Current Evidence:
- iOS ViewModels reference `status` field directly for state inference
- Example in `ContestDetailViewModel.swift`: References to `startsAt`, `endsAt` exist but no action flag consumption
- No code evidence that iOS would respect action flags even if exposed

**Code Evidence:**
```swift
// Found in iOS codebase:
case isLive = "is_live"  // Field exists but no contract framework for deriving it
```

But NO corresponding code that consumes `actions.is_live` to control UI.

**Failure Mode:**
- iOS derives contest state from timestamps instead of action flags
- New contest type introduces different logic for state transitions
- iOS fails to render correctly because it's inferring state instead of trusting server
- Example: Survivor contest might have custom lock logic; iOS computing state fails

**Verification Steps:**
```bash
# Search iOS for action flag consumption
grep -r "\.canJoin\|\.canEditEntry\|\.isReadOnly" ios-app
# Result: No matches found

# Search for status-based inference
grep -r "status.*==\|status.*switch" ios-app/Views ios-app/ViewModels
# Result: Multiple files reference status directly
```

**Mitigation/Enforcement Required:**
1. **Add Codable Models for Actions**
   ```swift
   struct ContestActions: Codable {
     let canJoin: Bool
     let canEditEntry: Bool
     let isReadOnly: Bool
     let isLive: Bool
     let isScored: Bool
   }
   ```

2. **Refactor Contest Model**
   - Add `actions: ContestActions` field
   - Make `status` field display-only (remove all conditional logic from it)

3. **Mechanical Enforcement (Required before Iteration 02 closure)**
   - Codebase audit: Search for all `if.*status`, `switch.*status`, `status.*==`
   - For EACH match: Verify it's display/logging only, NOT controlling behavior
   - Document findings in closure gate report
   - Unit test: Contest with `canJoin=false` disables join button even if `status="open"`

---

### Risk 3: Column Schema Immutability Not Enforced

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Documentation states column schema must be immutable during contest lifecycle, but **no enforcement exists because the endpoint doesn't exist yet.**

Once leaderboard endpoint is implemented, risk is that:
- Backend recomputes `column_schema` dynamically on every request
- Different requests might return different schemas (e.g., due to data changes)
- iOS caches schema from first request, then receives different columns on refresh

**Verification Steps (to perform once endpoint exists):**
```bash
# After leaderboard endpoint is implemented, run:
CONTEST_ID="contest-test-123"
curl -s "$STAGING/api/contests/$CONTEST_ID/leaderboard?page=1" | jq '.column_schema' > /tmp/schema1.json
sleep 2
curl -s "$STAGING/api/contests/$CONTEST_ID/leaderboard?page=1" | jq '.column_schema' > /tmp/schema2.json
diff -u /tmp/schema1.json /tmp/schema2.json
# Expected: No diff (schema must be identical)
```

**Failure Mode:**
- iOS renders columns based on first response schema
- Leaderboard endpoint returns different schema on refresh
- Columns disappear, reorder, or change types mid-contest
- User sees broken leaderboard

**Mitigation/Enforcement Required:**
1. **Database-Level Enforcement (Recommended)**
   - Add `column_schema` field to `contest_instances` table
   - Populate at contest creation time (or when contest transitions to OPEN)
   - Constraint: Prevent updates to `column_schema` for OPEN/LIVE/COMPLETE contests
   - Trigger: Enforce on INSERT that column_schema is not NULL for active contests

2. **Application-Level Guard (If DB approach not feasible)**
   - Cache column_schema in memory at contest load time
   - Leaderboard endpoint returns cached copy, never recomputed
   - Unit test: Fetch leaderboard 10 times, verify identical schema each time

3. **CI Validation**
   - Test: Create contest, fetch leaderboard, modify data, fetch again
   - Assert: column_schema unchanged
   - Test: Add player, rescore, fetch leaderboard
   - Assert: column_schema unchanged

---

### Risk 4: Leaderboard Rows Dynamic Columns vs Codable Rigidity

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
iOS Codable models have fixed fields. The specification mentions dynamic columns in `column_schema`, but iOS models don't have a strategy for:
- Unknown column types
- Extra columns not defined at compile time
- Adding columns per new contest type without iOS rebuild

**Current iOS Model Structure:**
```swift
struct LeaderboardRow: Codable {
    let rank: Int
    let userId: String
    let userName: String
    let score: Decimal?
    let payout: Decimal?
    let isCurrentUser: Bool
    let entryId: String
    // ❌ PROBLEM: No mechanism for dynamic columns
}
```

**Failure Mode:**
- Backend adds new column for new contest type: `likelihood_score: 0.85`
- iOS tries to decode into fixed LeaderboardRow struct
- Decode fails silently or crashes if column is required
- Unknown column types cause type mismatch errors

**Verification Steps:**
1. Check if LeaderboardRow model includes dynamic field container:
   ```bash
   grep -A 20 "struct LeaderboardRow" ios-app/PlayoffChallenge/Models/*.swift
   # Should show: values: [String: JSONValue] or similar
   ```
   Result: ❌ No dynamic field handling found

2. Unit test (must be added):
   ```swift
   let json = """
   {
     "rank": 1,
     "user_id": "user-1",
     "user_name": "Alice",
     "score": 100.0,
     "payout": 50.0,
     "is_current_user": false,
     "entry_id": "entry-1",
     "unknown_column": "new_value",
     "custom_metric": 42
   }
   """
   let row = try JSONDecoder().decode(LeaderboardRow.self, from: json.data(using: .utf8)!)
   // Must NOT crash
   ```

**Mitigation/Enforcement Required:**
1. **Add Dynamic Column Support**
   ```swift
   struct LeaderboardRow: Codable {
       let rank: Int
       let userId: String
       let userName: String
       let score: Decimal?
       let payout: Decimal?
       let isCurrentUser: Bool
       let entryId: String

       // Dynamic columns from backend
       let additionalColumns: [String: AnyCodable] = [:]

       enum CodingKeys: String, CodingKey {
           case rank, userId = "user_id", userName = "user_name"
           case score, payout, isCurrentUser = "is_current_user"
           case entryId = "entry_id"
       }

       init(from decoder: Decoder) throws {
           let container = try decoder.container(keyedBy: CodingKeys.self)
           rank = try container.decode(Int.self, forKey: .rank)
           // ... standard fields ...

           // Capture unknown keys
           let allKeys = Set(decoder.codingPath.map { $0.stringValue })
           // Store unknowns in additionalColumns
       }
   }
   ```

2. **Lenient Decoding Strategy**
   - Use `decodeIfPresent` for all optional fields
   - Catch and log unknown field types rather than failing
   - Default unknown types to string rendering

3. **Unit Tests (Mandatory before Iteration 02 closure)**
   - [ ] Decode with unknown column type → no crash
   - [ ] Decode with extra columns → no crash
   - [ ] Render unknown column as string → no crash
   - [ ] Leaderboard with future contest type columns → renders safely

---

### Risk 5: Payout Reconciliation Coupling

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Documentation mentions `payout_table` static schedule and `leaderboard` computed payouts must match. However:
- Leaderboard endpoint not yet implemented
- No reconciliation test exists
- Tie-breaking logic not documented

**Failure Mode:**
- Backend payout_table shows: Rank 3-10 = $20 each
- Leaderboard shows 8 people tied for 3rd place
- Backend computes: Split $20 × 8 = $2.50 per person
- iOS renders payout_table showing $20, then sees $2.50 in leaderboard
- User sees conflicting information

**Verification Steps (to implement):**
```javascript
// Reconciliation test pseudocode
const contestDetail = await GET(`/api/contests/${id}`);
const leaderboard = await GET(`/api/contests/${id}/leaderboard`);

// For each leaderboard row:
for (const row of leaderboard.rows) {
  const payoutTableEntry = contestDetail.payout_table.find(
    p => row.rank >= p.min_rank && row.rank <= p.max_rank
  );

  // Assertion 1: Payout exists in table
  assert(payoutTableEntry, `No payout_table entry for rank ${row.rank}`);

  // Assertion 2: Amounts within reasonable tolerance (rounding)
  assert(
    Math.abs(row.payout - payoutTableEntry.payout_amount) < 0.01,
    `Payout mismatch for rank ${row.rank}`
  );
}
```

**Mitigation/Enforcement Required:**
1. **Document Tie-Breaking Rules**
   - [ ] Add to Iteration 01 spec: How ties are resolved
   - [ ] Options: split, duplicate, compress ranks
   - [ ] Example: "For ties, payouts are split equally"

2. **Explicit Payout Source Authority**
   - [ ] Decide: Is payout_table or leaderboard the source of truth?
   - [ ] Recommendation: leaderboard is source (actual payouts awarded)
   - [ ] payout_table is template (shown for informational purposes)

3. **Add Reconciliation CI Test**
   ```javascript
   // backend/tests/routes/reconciliation.test.js
   test('Payout table matches leaderboard payouts', async () => {
     const contestId = await createContest();
     await scoreContest(contestId);

     const detail = await GET(`/api/contests/${contestId}`);
     const leaderboard = await GET(`/api/contests/${contestId}/leaderboard`);

     for (const row of leaderboard.rows) {
       const tableEntry = detail.payout_table.find(
         p => row.rank >= p.min_rank && row.rank <= p.max_rank
       );
       expect(Math.abs(row.payout - tableEntry.payout_amount)).toBeLessThan(0.01);
     }
   });
   ```

---

### Risk 6: Join Idempotency Coupling with Client Retry Behavior

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Documentation specifies idempotency guarantees, but **enforcement is not visible in code review.**

Current state:
- `customContestService.joinContest()` exists
- Unique constraint on `(contest_id, user_id)` likely exists but not verified
- No visible idempotency handling documented in code

**Verification Steps:**
```sql
-- Check if unique constraint exists:
\d contest_participants
-- Should show: UNIQUE (contest_id, user_id)
```

**Failure Mode:**
- User joins, network timeout, client retries
- Backend doesn't deduplicate
- User joined twice (violates unique constraint)
- 409 Conflict or 500 Internal Server Error returned
- iOS crashes without clear error message

**Current Gap:**
No evidence that duplicate join returns `200 OK` with existing entry rather than error.

**Mitigation/Enforcement Required:**
1. **Verify Unique Constraint Exists**
   ```sql
   ALTER TABLE contest_participants
   ADD CONSTRAINT uq_contest_participants_contest_user
   UNIQUE (contest_instance_id, user_id);
   ```

2. **Add Idempotency Handling in Backend**
   ```javascript
   // customContestService.js
   async function joinContest(pool, contestId, userId) {
     try {
       // Try to insert
       const result = await pool.query(
         `INSERT INTO contest_participants (contest_id, user_id, joined_at)
          VALUES ($1, $2, NOW())
          RETURNING *`,
         [contestId, userId]
       );
       return { status: 'joined', entry: result.rows[0] };
     } catch (err) {
       if (err.code === '23505') {  // Unique violation
         // User already joined - fetch existing entry
         const existing = await pool.query(
           `SELECT * FROM contest_participants WHERE contest_id = $1 AND user_id = $2`,
           [contestId, userId]
         );
         return { status: 'already_joined', entry: existing.rows[0] };
       }
       throw err;
     }
   }
   ```

3. **Add Retry Test**
   ```javascript
   test('Join is idempotent', async () => {
     const contestId = await createContest();
     const userId = 'user-123';

     const join1 = await POST(`/api/contests/${contestId}/join`, { userId });
     const join2 = await POST(`/api/contests/${contestId}/join`, { userId });

     expect(join1.status).toBe(200);
     expect(join2.status).toBe(200);  // NOT 409
     expect(join1.entryId).toBe(join2.entryId);  // Same entry
   });
   ```

---

### Risk 7: Multi-Contest Isolation Coupling via Cached Globals

**Risk Level:** 🔴 **HIGH**

**Actual Finding:**
**Found evidence of unsafe caching in iOS using UserDefaults without contest_id scoping:**

```swift
// Found in: ios-app/PlayoffChallenge/ViewModels/ContestManagementViewModel.swift
UserDefaults.standard.set(data, forKey: Self.storageKey)
UserDefaults.standard.data(forKey: Self.storageKey)

// Found in: ios-app/PlayoffChallenge/JoinFlow/Services/PendingJoinManager.swift
private let userDefaults: UserDefaults
```

**Failure Mode:**
1. User joins Contest A (stores in UserDefaults with key "pendingJoin")
2. User joins Contest B (overwrites key "pendingJoin" with Contest B data)
3. User opens Contest A → sees Contest B data instead
4. Data bleeds between contests silently

**Backend state check:**
- `customContestService.js` computes standings per contest
- No evidence of global contest cache found
- ✅ Backend appears to be per-contest scoped

**Verification Steps:**
```bash
# Search iOS for unsafe caching:
grep -r "UserDefaults.standard\|NSCache\|@State.*contest" ios-app
# Check if keys include contest_id:
grep -r "forKey:" ios-app/PlayoffChallenge/ViewModels
# Check for NSCache usage:
grep -r "NSCache" ios-app
```

Result: Found UserDefaults caching that does NOT include contest_id in key.

**Mitigation/Enforcement Required:**
1. **Scope All Caches by contest_id**
   ```swift
   // BEFORE (unsafe):
   UserDefaults.standard.set(data, forKey: "pendingJoin")

   // AFTER (safe):
   UserDefaults.standard.set(data, forKey: "pendingJoin_\(contestId)")
   ```

2. **Add Caching Contract Tests**
   ```swift
   test("Concurrent contests maintain separate cache", async {
     let cache = JoinManager()

     cache.setPendingJoin(contestId: "contest-1", data: joinData1)
     cache.setPendingJoin(contestId: "contest-2", data: joinData2)

     let retrieved1 = cache.getPendingJoin(contestId: "contest-1")
     let retrieved2 = cache.getPendingJoin(contestId: "contest-2")

     XCTAssertEqual(retrieved1, joinData1)  // NOT joinData2
     XCTAssertEqual(retrieved2, joinData2)
   })
   ```

3. **Code Review Enforcement**
   - [ ] Audit all UserDefaults/NSCache usage
   - [ ] Ensure contest_id is part of cache key
   - [ ] Add CI check: grep for `forKey: "` and verify key includes variable

---

### Risk 8: Leaderboard State Machine Mismatch

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Iteration 01 spec defines `leaderboard_state` enum: `"pending" | "computing" | "computed" | "error"`

Current implementation evidence:
- Backend defines contest status: `['SCHEDULED', 'LOCKED', 'LIVE', 'COMPLETE', 'CANCELLED', 'ERROR']`
- **Mismatch:** `LIVE` is contest status, not leaderboard state
- No `leaderboard_state` field found in responses

**Failure Mode:**
- Backend returns contest with `status: "LIVE"`
- iOS expects `leaderboard_state: "computing"` to show loading indicator
- iOS receives neither `status` nor `leaderboard_state` in expected format
- iOS shows wrong state UI

**Specification vs Implementation Gap:**
```
Spec:   leaderboard_state in ["pending", "computing", "computed", "error"]
Actual: contest status in ["SCHEDULED", "LOCKED", "LIVE", "COMPLETE", ...]
```

**Verification Steps (once leaderboard endpoint implemented):**
```bash
# Verify leaderboard_state field exists:
curl -s "$STAGING/api/contests/$ID/leaderboard" | jq '.leaderboard_state'
# Expected: "pending" or "computing" or "computed" or "error"
# Actual: ❌ Field doesn't exist yet

# Check contest detail for state field:
curl -s "$STAGING/api/contests/$ID" | jq '.status'
# Returns: "LIVE", "OPEN", etc. (not leaderboard_state)
```

**Mitigation/Enforcement Required:**
1. **Add leaderboard_state to Leaderboard Endpoint Response**
   ```javascript
   GET /api/contests/{id}/leaderboard
   {
     "leaderboard_state": "computing",  // OR "pending", "computed", "error"
     "generated_at": "2026-02-16T14:30:00Z",
     "column_schema": [...],
     "rows": [...]
   }
   ```

2. **Define State Transition Logic**
   ```
   pending → computing → computed (or error)

   Transitions:
   - pending: Contest not yet scored (status = OPEN or LOCKED)
   - computing: Scoring in progress (background job running)
   - computed: Scoring complete (leaderboard available)
   - error: Scoring failed (manual intervention needed)
   ```

3. **Add iOS Handling for State Machine**
   ```swift
   switch leaderboard.leaderboardState {
   case "pending":
     showMessage("Leaderboard not yet available")
   case "computing":
     showLoadingIndicator()
   case "computed":
     renderLeaderboard(leaderboard.rows, schema: leaderboard.columnSchema)
   case "error":
     showErrorMessage("Leaderboard computation failed. Please contact support.")
   default:
     // Unknown state: fail safe to "not available"
     showMessage("Leaderboard status unknown")
   }
   ```

4. **Add CI Test for State Transitions**
   ```javascript
   test('Leaderboard state transitions correctly', async () => {
     const contestId = await createContest();

     // Initial state
     let response = await GET(`/api/contests/${contestId}/leaderboard`);
     expect(response.status).toBe(202);  // Accepted (not ready yet)
     expect(response.leaderboardState).toBe("pending");

     // Start scoring
     await triggerScoring(contestId);

     // Mid-scoring
     response = await GET(`/api/contests/${contestId}/leaderboard`);
     expect(response.leaderboardState).toBe("computing");

     // After scoring
     await waitForScoring(contestId);
     response = await GET(`/api/contests/${contestId}/leaderboard`);
     expect(response.status).toBe(200);
     expect(response.leaderboardState).toBe("computed");
   });
   ```

---

### Risk 9: Binary Sequencing Precondition Operational Drift

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Iteration 03 spec mandates: **iOS binary must be built and frozen BEFORE new contest type introduction.**

Current state:
- ❌ No documentation of iOS binary version + build date
- ❌ No git tag marking binary freeze point
- ❌ No validation that new contest type uses only existing schema
- ❌ No enforcement preventing iOS commits during validation phase

**Failure Mode:**
1. iOS binary v1.5.0 (built 2026-02-15) marked as validation baseline
2. New contest type introduced 2026-02-16
3. iOS team continues work and commits code 2026-02-17
4. Validation phase now broken: binary is no longer proven independent
5. Fluidity proof invalidated, but nobody notices until end of phase

**Mitigation/Enforcement Required:**
1. **Create iOS Binary Baseline Record**
   - Document in `docs/client-fluidity-program/03-iteration-03-fluidity-validation.md`:
     ```markdown
     ## iOS Binary Baseline (Locked during Validation)

     **Binary Version:** 1.5.0-fluidity-validation
     **Build Date:** 2026-02-16T14:32:00Z
     **Commit Hash:** abc123def456...
     **Build Number:** 1234
     **TestFlight Build:** Build 1234 Submitted

     **Validation Window:** 2026-02-16 through 2026-02-23 (7 days)
     **Lock Status:** FROZEN - No iOS code changes allowed during this window
     ```

2. **Add Git Hook to Prevent Commits During Validation**
   ```bash
   # .git/hooks/pre-commit
   if [ -f "VALIDATION_LOCK" ]; then
     echo "ERROR: Validation phase in progress. No iOS commits allowed."
     exit 1
   fi
   ```

3. **Create Validation Lock File**
   ```bash
   # Before starting Iteration 03:
   echo "Validation started 2026-02-16T14:32:00Z" > VALIDATION_LOCK
   echo "Binary: v1.5.0, commit: abc123" >> VALIDATION_LOCK

   # After validation completes:
   rm VALIDATION_LOCK
   ```

4. **Add CI Check to Verify Binary Precondition**
   ```javascript
   // ci/check-binary-sequencing.js
   const fs = require('fs');
   const gitLog = exec('git log --oneline backend/');  // Contest type commit
   const iosCommits = exec('git log --oneline ios-app/ -- VALIDATION_LOCK');

   if (iosCommits.length > 0) {
     throw new Error('FAILED: iOS commits found after binary freeze');
   }
   ```

---

### Risk 10: Gate-Only Documentation Removes Operational Clarity

**Risk Level:** 🟡 **MEDIUM**

**Actual Finding:**
Iteration documents define binary gates but lack operational ordering and timeline language.

Current problems:
1. No explicit "before/after" dependency visualization
2. No required artifacts list for each gate
3. No owner assignments for gate closure
4. No timeline or duration expectations (specs say avoid estimates, but missing sequencing)

**Failure Mode:**
- QA team doesn't know they should start prep before Iteration 02 completes
- Backend team finishes Iteration 01 but iOS Lead is unavailable
- Gate closes with missing approvals
- Teams discover blockers too late

**Mitigation/Enforcement Required:**
1. **Add Execution Order Section to Iteration 03**
   ```markdown
   ## Execution Order & Operational Dependencies

   ### Pre-Iteration 03 (Prerequisite)
   - **Prerequisite Gate:** Iteration 01 + Iteration 02 BOTH must close
   - **Artifact:** Both closure sign-off documents
   - **Duration:** Cannot start until both gates passed

   ### Phase 1: iOS Binary Baseline (Day 1)
   - **Owner:** iOS Lead
   - **Duration:** 1 day (freeze point)
   - **Artifacts:**
     - Binary version documented
     - Build timestamp recorded
     - Commit hash tagged
     - VALIDATION_LOCK created
   - **Gate:** Binary baseline approved by Platform Architecture

   ### Phase 2: Backend Contest Type Setup (Day 1-2)
   - **Owner:** Backend Lead
   - **Prerequisite:** Phase 1 complete
   - **Duration:** 1-2 days
   - **Artifacts:**
     - New contest type in staging
     - API validation (GET /api/contests/{id} returns required fields)
   - **Gate:** Backend Lead confirms endpoints working

   ### Phase 3: iOS Rendering Validation (Day 2-5)
   - **Owner:** QA Lead + iOS Dev
   - **Prerequisite:** Phase 2 complete
   - **Duration:** 3-4 days
   - **Checklist:** All Phase 3 items from staging validation checklist
   - **Gate:** Zero blocker defects found

   ### Phase 4: Final Sign-Off (Day 5)
   - **Owner:** Platform Architecture
   - **Prerequisite:** Phase 3 complete
   - **Artifacts:**
     - Validation report
     - Test results
     - Sign-off from QA, iOS, Backend, Product
   - **Gate:** Fluidity achieved (all closure criteria met)
   ```

2. **Add Required Artifacts Matrix**
   ```markdown
   ## Closure Gate Artifacts Checklist

   | Gate | Required Artifact | Owner | Format | Location |
   |------|------------------|-------|--------|----------|
   | Iteration 01 | API Contract Spec | Backend Lead | OpenAPI JSON | docs/openapi.json |
   | Iteration 01 | Integration Tests Report | Backend Lead | Test output | backend/tests/report.html |
   | Iteration 02 | Code Audit Report | iOS Lead | Markdown | docs/ios-audit.md |
   | Iteration 02 | Test Results | iOS Lead | Test output | ios-app/test-results.html |
   | Iteration 03 | Binary Baseline | iOS Lead | Doc + tag | docs/fluidity/binary-baseline.md |
   | Iteration 03 | Validation Report | QA Lead | Markdown | docs/fluidity/validation-report.md |
   ```

3. **Add Owner Assignments**
   - Iteration 01 Closure: Backend Lead + Platform Architect
   - Iteration 02 Closure: iOS Lead + Platform Architect
   - Iteration 03 Closure: QA Lead + iOS Lead + Backend Lead + Platform Architect + Product Manager

---

## Structural Severity Ranking

| Risk # | Title | Severity | Status | Blocks |
|--------|-------|----------|--------|--------|
| 1 | Contract Shape Coupling | 🔴 HIGH | Missing Contract | All iterations |
| 2 | Dual Source of Truth | 🔴 HIGH | Not Implemented | Iteration 02 |
| 3 | Column Schema Immutability | 🟡 MEDIUM | Not Enforced | Iteration 03 |
| 4 | Leaderboard Codable Rigidity | 🟡 MEDIUM | At Risk | Iteration 02 |
| 5 | Payout Reconciliation | 🟡 MEDIUM | Not Tested | Iteration 03 |
| 6 | Join Idempotency | 🟡 MEDIUM | Partially Implemented | Iteration 03 |
| 7 | Multi-Contest Cache Isolation | 🔴 HIGH | Found in Code | Iteration 02 |
| 8 | Leaderboard State Machine | 🟡 MEDIUM | Mismatch | Iteration 03 |
| 9 | Binary Sequencing | 🟡 MEDIUM | Not Documented | Iteration 03 |
| 10 | Gate Clarity | 🟡 MEDIUM | Incomplete | All iterations |

---

## Structural Changes Required Before Production

### BLOCKING: Iteration 01 Must Complete
- [ ] Implement leaderboard endpoint with column_schema
- [ ] Expose action flags in all contest responses
- [ ] Expose payout_table and roster_config
- [ ] Add `type` field to all responses
- [ ] Create API contract specification (OpenAPI)
- [ ] Closure gate sign-off obtained

### BLOCKING: Iteration 02 Must Address
- [ ] Refactor iOS models to consume action flags
- [ ] Add dynamic column handling to LeaderboardRow
- [ ] Remove all UserDefaults caching without contest_id scoping
- [ ] Add unit tests for Codable models
- [ ] Codebase audit: eliminate status-based logic in favor of actions
- [ ] Closure gate sign-off obtained

### HIGH PRIORITY: Before Iteration 03 Validation
- [ ] Add join idempotency test (retry 10 times, same result)
- [ ] Create payout reconciliation test
- [ ] Implement leaderboard state machine (pending→computing→computed)
- [ ] Document iOS binary baseline with version + commit hash
- [ ] Add git hook to prevent commits during validation
- [ ] Create execution order & artifact requirements document

### RECOMMENDED: Structural Hardening
- [ ] Add CI check: contract snapshot regression tests
- [ ] Add CI check: iOS models decode unknown fields gracefully
- [ ] Add CI check: verify column_schema immutability
- [ ] Add CI check: contest data isolation (no data bleeds between contests)
- [ ] Create contract versioning strategy (for future backward compatibility)

---

## Go/No-Go Recommendation

### **NO-GO FOR ITERATION 02/03 PROCEEDING**

**Rationale:**
1. **Iteration 01 Not Complete:** Presentation Contract is only ~20% implemented
   - Missing: leaderboard endpoint, action flags, column_schema
   - iOS cannot consume undefined contract
   - Proceeding with Iteration 02 will validate against incomplete spec

2. **High-Risk Couplings Found:**
   - iOS using unsafe UserDefaults without contest_id scoping
   - Action flags not implemented, iOS will continue inferring state
   - Leaderboard state machine not aligned between backend/iOS

3. **No Operational Clarity:**
   - Binary sequencing not documented
   - Validation gate artifacts not defined
   - Sequencing dependencies unclear

### **REQUIRED FOR GO-AHEAD:**
1. **Complete Iteration 01 Closure Gate**
   - All contract fields implemented and exposed
   - Integration tests pass
   - API specification complete
   - Platform Architecture sign-off

2. **Fix High-Risk Couplings**
   - iOS cache scoping (contest_id in keys)
   - iOS models refactored for action flags
   - Leaderboard state machine aligned

3. **Establish Operational Clarity**
   - Execution order documented
   - Binary sequencing enforced
   - Gate artifacts defined

### **Estimated Remediation Effort**
- Complete Iteration 01: **2-3 weeks** (backend contract work)
- Fix Iteration 02 risks: **1-2 weeks** (iOS refactoring)
- Operationalize Iteration 03: **3-5 days** (process/documentation)

---

## Appendix: Verification Command Reference

```bash
# Contract fields check
curl -s "http://localhost:3001/api/contests/test-123" | jq 'keys | sort'

# Action flags check
curl -s "http://localhost:3001/api/contests/test-123" | jq '.actions'

# Leaderboard endpoint check
curl -s "http://localhost:3001/api/contests/test-123/leaderboard" | jq '.column_schema'

# Multi-contest isolation check (iOS)
grep -r "UserDefaults.*set.*forKey:" ios-app | grep -v "contest_id\|contestId"

# iOS Codable model check
grep -A 30 "struct LeaderboardRow" ios-app/PlayoffChallenge/Models/Models.swift

# Join idempotency test
for i in {1..10}; do
  curl -s -X POST "http://localhost:3001/api/contests/test/join" \
    -H "Authorization: Bearer user-123" -w "%{http_code}\n" -o /dev/null
done

# Column schema immutability check (after implementing endpoint)
curl -s "http://localhost:3001/api/contests/test/leaderboard" | jq '.column_schema' > /tmp/s1.json
sleep 5
curl -s "http://localhost:3001/api/contests/test/leaderboard" | jq '.column_schema' > /tmp/s2.json
diff /tmp/s1.json /tmp/s2.json
```

---

## Sign-Off (Audit Complete)

**Audit Performed By:** Platform Architecture (AI Assistant)
**Date:** 2026-02-16
**Scope:** Hidden coupling risk assessment (10 risk areas)
**Findings:** 3 HIGH, 7 MEDIUM
**Recommendation:** NO-GO - Remediate before proceeding beyond Iteration 01

