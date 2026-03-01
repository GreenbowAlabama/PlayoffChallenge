# iOS Sweep Protocol — Structured & Contract-Safe

**Purpose:** Enforce disciplined, deterministic iOS development through mandatory pre-reads, layer boundary enforcement, and structured sweep phases. Prevent drift between backend contracts and iOS implementation.

---

## 1. PRE-SWEEP GATE (MANDATORY)

**Claude must always read these files before any iOS implementation work:**

### Governance Layer
- ✅ `docs/governance/CLAUDE_RULES.md` — Global governance, frozen invariants, architecture boundaries
- ✅ `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — Authoritative lifecycle transitions and execution model

### Backend Contract Layer
- ✅ `backend/contracts/openapi.yaml` — Canonical API response shapes
- ✅ `backend/db/schema.snapshot.sql` — Database schema (for understanding domain constraints)

### iOS Contract Layer
- ✅ `ios-app/PlayoffChallenge/Contracts/*.swift` — All DTO files
- ✅ `ios-app/PlayoffChallenge/ViewModels/*.swift` — All ViewModel files
- ✅ `ios-app/PlayoffChallenge/Services/*.swift` — All Service files

**Gate Rule:** No implementation before this read. If any file is missing or changed, re-read before proceeding.

---

## 2. ARCHITECTURE LAYER BOUNDARIES

### Forbidden Crossings (HARD RULES)

| Layer | DO NOT | DO |
|-------|--------|-----|
| **DTO (Contract)** | Mutate without OpenAPI alignment | Decode from network only |
| | Add UI-only fields | Pass to ViewModel as-is |
| | Contain business logic | Remain data structs |
| **ViewModel** | Reference DTO directly in state | Convert DTO → Domain in `init` |
| | Call Service from View | Own all Service calls |
| | Derive lock status from status field alone | Use `lock_time` for time-based enforcement |
| **Service** | Make financial decisions | Fetch data, decode, validate shapes |
| | Implement business rules | Call API endpoints |
| | Transform domain objects | Return raw API responses |
| **View** | Call Service directly | Observe ViewModel only |
| | Implement join/payment logic | Render ViewModel state |
| | Decide lock/capacity state | Display computed properties from ViewModel |
| | Perform time comparisons | Show UI derived from ViewModel boolean flags |

### Critical Boundary Rules

1. **DTO→Domain Isolation**
   - DTOs never appear in ViewModel `@Published` properties
   - ViewModel owns the conversion: `DTO → Domain Model`
   - Example: `ContestDetailResponseDTO` → `Contest` in ViewModel init

2. **Time-Based vs Status-Based Enforcement**
   - Lock enforcement: MUST use `lock_time` (time-based)
   - Status: Descriptive only, NEVER sole enforcement
   - Example: `canJoin = (now < lock_time) && status == "SCHEDULED"`

3. **Contest Type Abstraction**
   - Contest `type` field defines behavior (e.g., "PGA", "NFL")
   - ViewModel: Remain sport-agnostic
   - Domain layer: Enforce contest-specific rules
   - Views: Never hardcode type-specific logic

4. **Snapshot Rendering**
   - LIVE leaderboard: Use dynamic standings from API
   - COMPLETE leaderboard: Use settlement_snapshot only
   - View: Display whichever ViewModel provides
   - ViewModel: Own the selection logic (based on status)

---

## 3. SWEEP EXECUTION MODEL

Each sweep is a **vertical slice** of iOS functionality. Sweeps are independent but ordered.

### Sweep 1 — Contract & Domain Integrity ✅ MANDATORY FIRST

**Purpose:** Verify DTO shapes match OpenAPI. Ensure layer boundaries are enforced.

**Checks:**
- [ ] All DTO fields match OpenAPI schema
- [ ] No DTO mutations in ViewModels
- [ ] No Service calls in Views
- [ ] Contest type behavior confined to Domain layer
- [ ] Domain models are clean (no UI state)

**Execution:**
```bash
cd ios-app/PlayoffChallenge
swift build
swift test
```

**Exit Criteria:**
- ✅ No build warnings
- ✅ All unit tests pass
- ✅ Architecture boundary violations fixed

**Documentation Update:**
- Confirm DTO→Domain mapping in appropriate ViewModel files
- Document any contest-type-specific domain rules

**Gap Report:**
```
Contract Gaps:
- [ ] Missing DTO fields vs OpenAPI
- [ ] Undocumented API response variations

Architecture Boundary Gaps:
- [ ] DTOs leaking into ViewModel state
- [ ] Service calls in Views
- [ ] Business logic in domain-agnostic Views

Contest-Type Behavior Gaps:
- [ ] Hardcoded type checks in Views
- [ ] Missing type abstraction in Domain
```

---

### Sweep 2 — Lineup & Lock Enforcement ✅ MANDATORY SECOND

**Purpose:** Verify entry enforcement uses `lock_time`, not status alone.

**Checks:**
- [ ] `canJoin` computes: `now < lock_time && status == "SCHEDULED"`
- [ ] Capacity enforcement applied correctly
- [ ] Join button disabled when `now >= lock_time`
- [ ] LOCKED state may be abstracted visually
- [ ] No client-side entry math or validation

**Execution:**
```bash
cd ios-app/PlayoffChallenge
swift build
swift test
```

**Exit Criteria:**
- ✅ Join button enforces time-based gating
- ✅ Capacity bar reflects accurate entry count
- ✅ No status-only lock enforcement

**Documentation Update:**
- Update ContestDetailViewModel comment: "Lock enforcement uses lock_time"
- Document capacity enforcement logic

**Gap Report:**
```
Lock-Time Enforcement Gaps:
- [ ] Status-only join gates (missing time check)
- [ ] No capacity reflection in UI
- [ ] Inconsistent lock message in different views

UI/Backend Assumption Drift:
- [ ] Join action assumes backend will re-validate
- [ ] Capacity bar assumes entry_count is live
- [ ] No offline-safety for time comparisons
```

---

### Sweep 3 — Leaderboards ✅ MANDATORY THIRD

**Purpose:** Verify LIVE uses dynamic scoring, COMPLETE uses snapshot.

**Checks:**
- [ ] LIVE leaderboard queries standings endpoint (dynamic)
- [ ] COMPLETE leaderboard uses settlement_snapshot (immutable)
- [ ] No client-side score recalculation
- [ ] No client payout math
- [ ] Leaderboard selection logic in ViewModel (not View)

**Execution:**
```bash
cd ios-app/PlayoffChallenge
swift build
swift test
```

**Exit Criteria:**
- ✅ LIVE standings refresh on interval
- ✅ COMPLETE standings use snapshot data only
- ✅ No payout recalculation in UI

**Documentation Update:**
- Document leaderboard data source logic in ContestLeaderboardViewModel
- Add comment: "LIVE uses dynamic API, COMPLETE uses snapshot"

**Gap Report:**
```
Leaderboard Source Gaps:
- [ ] Mixed data sources (dynamic + snapshot)
- [ ] No clear LIVE vs COMPLETE branching
- [ ] Missing snapshot_id field in standings DTO

Client-Side Financial Logic Gaps:
- [ ] Payout calculation in View
- [ ] Score recalculation on score change
- [ ] No audit trail for score changes

Snapshot Immutability Gaps:
- [ ] No distinction between settlement snapshot vs live standings
- [ ] No version tracking for snapshot_hash
```

---

### Sweep 4 — Payment Automation Surface ✅ MANDATORY FOURTH

**Purpose:** Verify join action respects backend constraints.

**Checks:**
- [ ] Join disabled when `now >= lock_time`
- [ ] Capacity enforced: `entry_count < max_entries`
- [ ] Error shapes match OpenAPI (ALREADY_JOINED, CONTEST_FULL, LOCKED, etc.)
- [ ] No silent fallback logic
- [ ] Contest state is authoritative (no local caching of decisions)

**Execution:**
```bash
cd ios-app/PlayoffChallenge
swift build
swift test
```

**Exit Criteria:**
- ✅ Join respects lock_time gate
- ✅ Join respects capacity gate
- ✅ Error handling matches OpenAPI
- ✅ No retries without backend re-validation

**Documentation Update:**
- Document join action constraints in ContestDetailViewModel
- List expected error codes from OpenAPI

**Gap Report:**
```
Payment Automation Gaps:
- [ ] Join allows entry past lock_time
- [ ] No capacity pre-check before join attempt
- [ ] Missing error code mapping from OpenAPI

Error Handling Drift:
- [ ] Unexpected error codes from backend
- [ ] Silent failure instead of user-facing error
- [ ] Retry logic bypassing backend re-validation

Assumption Drift:
- [ ] UI assumes entry_fee_cents is always positive
- [ ] No handling of NULL max_entries (unlimited)
- [ ] No graceful handling of payout_structure variations
```

---

### Sweep 5 — UX & Cosmetic Hardening ✅ OPTIONAL

**Purpose:** Consistency polish and error presentation.

**Checks:**
- [ ] Status badges consistent across all views
- [ ] Capacity bar visual accuracy (0-100%)
- [ ] Transition clarity (SCHEDULED→LOCKED→LIVE→COMPLETE→SETTLED)
- [ ] Empty states handled (no entries, no scores)
- [ ] Error messages user-friendly and informative

**Execution:**
```bash
cd ios-app/PlayoffChallenge
swift build
swift test
```

**Exit Criteria:**
- ✅ All status states rendered consistently
- ✅ Capacity bar reflects backend data
- ✅ Transitions clear and unambiguous
- ✅ No crashes on empty data

**Documentation Update:**
- Update design system documentation if tokens changed
- Document any status→visual-state mapping rules

**Gap Report:**
```
Visual Consistency Gaps:
- [ ] Status badge colors differ across views
- [ ] Capacity bar misalignment in different screens
- [ ] Inconsistent date formatting

Empty State Gaps:
- [ ] No message when standings = []
- [ ] No message when payout_table = []
- [ ] No graceful handling of missing organizer_name

Error Presentation Gaps:
- [ ] Generic "Something went wrong" messages
- [ ] No error code context for debugging
- [ ] No retry affordance in error state
```

---

## 4. ENFORCEMENT RULES (NON-NEGOTIABLE)

### 1. DTO Mutation Rule
- **Forbidden:** Modifying DTO fields without OpenAPI alignment
- **Allowed:** Decoding DTOs, passing to ViewModel, converting to Domain
- **Violation:** Missing `enum CodingKeys` update, undocumented field addition
- **Fix:** Sync OpenAPI → DTO (with comment referencing OpenAPI line)

### 2. OpenAPI Drift Rule
- **Forbidden:** Changing API shapes in iOS without updating backend/contracts/openapi.yaml
- **Allowed:** Consuming OpenAPI as-is, adding client-only computed properties
- **Violation:** New API field not in OpenAPI schema
- **Fix:** Update openapi.yaml (with explicit governance review)

### 3. Business Logic in Views Rule
- **Forbidden:** Decision logic (joins, payments, scoring) in Views
- **Allowed:** Display logic (color, text, visibility computed from ViewModel)
- **Violation:** View calling `ContestService.join()` directly
- **Fix:** Move to ViewModel, inject as @Published property

### 4. Financial Math in iOS Rule
- **Forbidden:** Client-side payout calculation, score recalculation, capacity math
- **Allowed:** Displaying backend-computed values (payout_table, settlement_snapshot)
- **Violation:** Computing `userShare = pool * (1 - rake)` in View
- **Fix:** Use backend-provided values only; log drift if computed != provided

### 5. Time-Based Enforcement Rule
- **Forbidden:** `status == "SCHEDULED"` as sole entry gate
- **Allowed:** `now < lock_time && status == "SCHEDULED"`
- **Violation:** Join enabled if `status == "SCHEDULED"` (ignoring lock_time)
- **Fix:** Add time comparison to canJoin logic

---

## 5. GAP REPORTING (MANDATORY)

At end of each sweep, Claude must produce a **Gap Report** documenting:

### 1. Contract Gaps
- Missing DTO fields vs OpenAPI
- Undocumented API variations
- Decoding errors or type mismatches

### 2. Architecture Boundary Gaps
- DTOs in ViewModel state (should be Domain)
- Service calls in Views (should be in ViewModel)
- Business logic in Views (should be in ViewModel or Domain)

### 3. Contest-Type Behavior Gaps
- Hardcoded sport-specific logic in generic Views
- Missing type-abstraction in Domain layer
- Inconsistent contest-type handling across features

### 4. UI/Backend Assumption Drift
- UI assumes fields that backend doesn't provide
- UI omits fields that backend requires
- Race conditions from stale local state
- No re-validation before operations

### 5. Recommended Next Sweep
- Which sweep should run next (based on gaps found)
- Which areas need deeper investigation
- Blockers (if any) for proceeding to next sweep

### Gap Report Format

```markdown
## Gap Report — Sweep N (Date)

### Contract Gaps
- [ ] Missing field: `settlement_snapshot` in StandingDTO
- [ ] Undocumented: Optional `payout_structure` handling

### Architecture Boundary Gaps
- [ ] View calling `ContestService.join()` (should use ViewModel)
- [ ] ContestDetailResponseDTO in @Published state (should convert to Contest)

### Contest-Type Behavior Gaps
- [ ] Hardcoded PGA lineup size in View (should be in Domain)
- [ ] No abstraction for roster_config variations

### UI/Backend Assumption Drift
- [ ] UI assumes `user_has_entered` reflects immediate join
- [ ] No timeout for join UI state reset
- [ ] Capacity bar might show stale entry_count

### Recommended Next Sweep
- Sweep 3 (Leaderboards) — blocked until Sweep 1 boundary gaps fixed
- Consider: Are there contest types not yet tested in Views?
```

---

## 6. SWIFT BUILD & TEST LOOP (REQUIRED BEFORE COMPLETION)

Every sweep must complete with:

```bash
# Build
cd ios-app/PlayoffChallenge
swift build

# Test
swift test

# Expected: Zero warnings, all tests pass
# If any failure: Fix → Re-run → Document fix in Gap Report
```

**Exit Criteria for Each Sweep:**
- ✅ `swift build` completes with zero warnings
- ✅ `swift test` passes (all test suites)
- ✅ No skipped tests
- ✅ No commented-out assertions

---

## 7. DOCUMENTATION UPDATE REQUIREMENT (PER SESSION)

After each sweep, Claude must:

1. **Update relevant ViewModel comments** with findings
   - Example: "Lock enforcement uses lock_time, not status"

2. **Document contest-type rules** if discovered
   - Example: "PGA contests use roster_config.maxLineupSize"

3. **Update architecture docs** if boundaries need clarification
   - Example: Add to docs/governance/CLAUDE_RULES.md § 6 if new boundary rule found

4. **Commit documentation changes** (Claude DOES NOT commit code, but documents changes for user review)

**Forbidden:** Silently leaving ambiguity in code or docs.

---

## 8. PHASE SEQUENCING RULES

Sweeps must execute in order:

1. **Sweep 1** ← Always first (foundational)
2. **Sweep 2** ← Depends on Sweep 1 (builds on boundaries)
3. **Sweep 3** ← Depends on Sweep 2 (uses clean ViewModels)
4. **Sweep 4** ← Depends on Sweep 3 (verifies constraints)
5. **Sweep 5** ← Depends on Sweep 4 (polish only)

**Skip Rule:** Sweeps 1-4 are mandatory. Sweep 5 is optional cosmetic hardening.

**Violation:** Attempting Sweep 3 without completing Sweep 1 issues a violation error.

---

## 9. ANTI-PATTERNS (FORBIDDEN)

| Anti-Pattern | Why It's Forbidden | Fix |
|-------------|-------------------|-----|
| DTO in @Published | Leaks network contract into UI state | Convert to Domain in ViewModel init |
| Service call in View | Circumvents ViewModel ownership | Move to ViewModel, expose as @Published |
| Status-only lock check | Ignores time-based enforcement | Add `now < lock_time` check |
| Client-side payout math | Duplicates backend logic, drifts | Use backend-computed payout_table only |
| Hardcoded contest types | Breaks contest abstraction | Use domain layer, pass type to rules engine |
| Silent error fallback | Hides failures from user | Show error message from OpenAPI error_code |
| Local state as source of truth | Races with backend changes | Re-fetch before critical operations |

---

## 10. SCOUT RULE FOR iOS

**Leave the iOS codebase cleaner than you found it:**

- [ ] Fix ambiguous ViewModel comments
- [ ] Clarify layer boundaries if violated
- [ ] Add missing DTO field mappings
- [ ] Document contest-type rules
- [ ] Update architecture docs if gaps found

---

## 11. QUICK REFERENCE — SWEEP CHECKLIST

### Sweep 1 (Contract & Domain)
- [ ] Pre-read gate completed
- [ ] swift build passes
- [ ] swift test passes
- [ ] DTO fields match OpenAPI
- [ ] No DTOs in ViewModel state
- [ ] Gap report filed

### Sweep 2 (Lock & Lineup)
- [ ] Join uses `lock_time` enforcement
- [ ] Capacity bars render correctly
- [ ] Swift test passes
- [ ] Gap report filed

### Sweep 3 (Leaderboards)
- [ ] LIVE uses dynamic standings
- [ ] COMPLETE uses snapshot
- [ ] No client payout math
- [ ] Swift test passes
- [ ] Gap report filed

### Sweep 4 (Payment Automation)
- [ ] Join respects lock_time
- [ ] Join respects capacity
- [ ] Error codes match OpenAPI
- [ ] Swift test passes
- [ ] Gap report filed

### Sweep 5 (UX Polish)
- [ ] Status badges consistent
- [ ] Capacity bars aligned
- [ ] Empty states handled
- [ ] Swift test passes
- [ ] Gap report filed

---

## 12. WHEN TO INVOKE THIS PROTOCOL

Use iOS Sweep Protocol when:
- ✅ Adding new iOS features
- ✅ Fixing iOS bugs
- ✅ Refactoring ViewModels or Services
- ✅ Updating DTO contracts
- ✅ Any iOS changes affecting Views, ViewModels, or Services

Do NOT use when:
- ❌ Reading code for understanding only
- ❌ Researching architecture questions
- ❌ Documenting existing code

---

**This protocol is a governance lock.**

**Future Claude sessions cannot bypass sweep structure.**

**All iOS work follows this protocol.**
