# PHASE 8-11 QUICK REFERENCE CARD
## For Team Leads & Developers

---

## 🎯 NORTH STAR
**By Week 8**: Production-ready multi-contest platform with full Domain types, iOS integration, deterministic scoring, and payout idempotency.

---

## 📅 EXECUTION TIMELINE

```
WEEK 1-2: Phase 8 (Domain Types)
├─ Core Dev: 22h — Define 9 Domain types, mapping logic
├─ QA: 6h — Unit tests (snapshot, mapping edge cases)
└─ Gate: swift build ✓ | 90+ tests ✓

WEEK 2-3: Phase 9 (iOS Integration)
├─ iOS Dev: 15h — ViewModel updates, UI wiring
├─ QA: 4h — Protocol injection verification
└─ Gate: xcodebuild ✓ | zero warnings ✓

WEEK 3-4: Phase 10 (Testing & Risk Mitigation)
├─ QA: 25h — Integration tests, payout logic, multi-contest isolation
├─ DevOps: 3h — CI/CD setup
└─ Gate: 150+ tests ✓ | all gates ✓

WEEK 4-8: Phase 11 (Scaling & Hardening)
├─ Backend Dev: 28h — Batch scoring, idempotent settlement, locking
└─ QA: 9h — Stress tests, determinism verification
```

---

## 🔴 CRITICAL BLOCKERS (Resolve Week 1)

| Blocker | Impact | Owne | ETA |
|---------|--------|------|-----|
| **Contest struct incomplete** | All downstream features blocked | Core Dev | Day 2 |
| **Contract→Domain mapping inconsistent** | DTO leaks into ViewModels | Core Dev | Day 4 |
| **Multi-contest isolation untested** | Risk: contest A affects contest B | QA | Week 3 |
| **Payout logic untested** | Risk: double-payouts, incorrect settlements | QA | Week 3 |
| **iOS build verification missing** | Can't verify integration without xcodebuild | QA | Week 2 |

---

## 📋 PHASE 8 CHECKLIST (Core Dev — Week 1-2)

### Day 1: Read Specs
- [ ] Read CLAUDE.md § Multi-contest isolation
- [ ] Read PHASE_8_11_IMPLEMENTATION_GUIDE.md § Domain Types
- [ ] Read Contest.swift spec (23 fields defined)
- [ ] Ask any clarifying questions

### Day 2-3: Create Types
- [ ] Create `Contest.swift` (4h)
  - All 23 fields with comments
  - Initializer + Codable/Hashable
  - `.from(contract)` mapper
  - `.stub()` method
- [ ] Create `Standing.swift` (2h)
- [ ] Create `PayoutRow.swift` (2h)

### Day 3-4: Fix & Export
- [ ] Fix `ContestActionState.swift` — remove Contract refs (2h)
- [ ] Complete `RosterConfig.swift` (1h)
- [ ] Define `LeaderboardState` enum (1h)
- [ ] Update `core.swift` exports (1h)

### Day 4-5: Build & Test
- [ ] `swift build` — zero warnings ✓
- [ ] `swift test` — 90+ tests ✓
- [ ] Code review + merge ✓

**Success**: All Domain types defined, 90+ tests pass, core.swift exports updated.

---

## 📋 PHASE 9 CHECKLIST (iOS Dev — Week 2-3)

### Day 1: Planning
- [ ] Read PHASE_8_11_IMPLEMENTATION_GUIDE.md § ViewModels
- [ ] Review current ViewModel implementations
- [ ] Identify all @Published properties returning DTO

### Day 2: Updates
- [ ] Update `AvailableContestsViewModel` (3h)
  - Import Core
  - Change @Published from DTO to Contest
  - Verify protocol injection
- [ ] Update `ContestDetailViewModel` (2h)
- [ ] Update `ContestLeaderboardViewModel` (2h)

### Day 3: UI Wiring
- [ ] Wire "Create Contest" dropdown to service (4h)
- [ ] Delete iOS app `Domain/` folder (1h)
- [ ] Update all imports in Models.swift (1h)

### Day 4: Build & Verify
- [ ] `xcodebuild -scheme PlayoffChallenge` ✓
- [ ] Zero warnings/errors ✓
- [ ] Code review + merge ✓

**Success**: iOS app builds, ViewModels publish Domain types, zero warnings.

---

## 📋 PHASE 10 CHECKLIST (QA — Week 3-4)

### Day 1: Setup
- [ ] Set up snapshot testing framework
- [ ] Create test data fixtures
- [ ] Review test templates above

### Day 2-3: Unit Tests (6h)
- [ ] Contest.from() mapping tests
  - Happy path (all fields)
  - Null handling (optional fields)
  - Invalid UUIDs (fallback to UUID())
  - Invalid dates (fallback to Date())
  - Status enum mapping
  - Equatable & Hashable
  - Snapshot tests
- [ ] ContestActionState.from() tests (3h)
- [ ] Snapshot regression tests (2h)

### Day 3-4: Integration Tests (6h)
- [ ] Contract→Domain→ViewModel flow
- [ ] Leaderboard rendering with dynamic schema
- [ ] Concurrent joins (capacity check, no duplicates)

### Day 4-5: Payout & Multi-Contest (9h)
- [ ] Payout calculations (tiered, rounding edge cases)
- [ ] Payout idempotency (settle 2x = settle 1x)
- [ ] Multi-contest isolation (Contest A ≠ Contest B)
- [ ] Fuzz tests (malformed JSON)

### Day 5: CI/CD & Docs
- [ ] Set up GitHub Actions workflow (3h)
- [ ] Add lint rules (Codable, Hashable, no DTO)
- [ ] Documentation updates (2h)

**Success**: 150+ tests passing, no flakiness, all gates green.

---

## 📋 PHASE 11 CHECKLIST (Backend Dev — Week 4-8)

### Week 4-5: Concurrency & Idempotency
- [ ] **11.1** SELECT FOR UPDATE locking (prevent duplicate joins) — 6h
- [ ] **11.3** Idempotent settlement (same input = same output) — 5h
- [ ] **11.7** Idempotency unit tests — 4h

### Week 5-6: Batch Scoring & Audit
- [ ] **11.2** Batch contest scoring (100+ contests) — 8h
- [ ] **11.4** Audit logging (replay trail) — 6h

### Week 6-7: Optimization & Testing
- [ ] **11.6** Pagination optimization — 4h
- [ ] **11.8** Stress tests (1000 participants) — 5h

### Week 7-8: Polish & Documentation
- [ ] **11.5** Soft-delete contests — 3h
- [ ] **11.9** Operations runbook — 3h
- [ ] Final code review + merge

**Success**: Batch scoring < 2s/contest, idempotent payouts proven, 1000 participant stress test passes.

---

## 🔑 KEY FILES TO KNOW

| File | Purpose | Status | Owner |
|------|---------|--------|-------|
| `PHASE_8_11_IMPLEMENTATION_GUIDE.md` | Full specs, test templates, CI/CD | 📄 Created | All |
| `CLAUDE.md` | Platform rules (multi-contest, isolation) | 📄 Reference | Architecture |
| `core/Sources/core/Domain/*.swift` | Domain type definitions | 🔴 WIP (Phase 8) | Core Dev |
| `ios-app/.../ViewModels/*.swift` | ViewModel implementations | 🔴 WIP (Phase 9) | iOS Dev |
| `core/Tests/coreTests/Domain/*.swift` | Domain unit tests | 🔴 WIP (Phase 10) | QA |
| `.github/workflows/build-and-test.yml` | CI/CD pipeline | 🔴 WIP (Phase 10) | DevOps |
| `core/Sources/core/Mutations/*` | Service layer (production-ready) | ✅ Done | Backend |
| `core/Sources/core/Contracts/*` | DTO layer | ✅ Done | Backend |

---

## ⚠️ CRITICAL RULES (From CLAUDE.md)

### Multi-Contest Invariants
1. **Scoped by contest_id** — All reads/writes must include contest_id
2. **No global state** — Never assume a single active contest
3. **Isolation is mandatory** — Contest A failure ≠ Contest B failure

### Domain Layer Invariants
1. **Never fabricate fields** — Only map from backend contracts
2. **No optional fields** (unless explicitly from backend) — Required fields are non-optional
3. **Codable + Hashable** — All Domain types must conform
4. **No DTO/Contract in ViewModels** — Only import Domain types

### Testing Invariants
1. **Deterministic scoring** — Same input = same output (testable via replay)
2. **No manual admin steps** — Lifecycle must be automated
3. **Isolation tests mandatory** — Verify Contest A ≠ Contest B

---

## 🚦 DEFINITION OF DONE

### Per Task:
- ✅ Code written to spec (see PHASE_8_11_IMPLEMENTATION_GUIDE.md)
- ✅ Tests written and passing (100% green)
- ✅ No warnings/errors in build
- ✅ Code review approved (2 reviewers)
- ✅ Merged to `staging` (not main)
- ✅ CI/CD gates all passing
- ✅ Documentation updated

### Per Phase:
- ✅ All tasks in phase complete
- ✅ Success criteria met (see checklist above)
- ✅ Zero regressions in existing tests
- ✅ Tagged in git (PHASE_8_COMPLETE, etc.)

---

## 📞 SUPPORT & ESCALATION

| Question | Owner | Slack |
|----------|-------|-------|
| Architecture decisions | Platform Architect | #architecture |
| Domain type specs | Core Dev Lead | #core-dev |
| ViewModel wiring | iOS Dev Lead | #ios-dev |
| Test strategy | QA Lead | #qa |
| Timeline/resources | Project Manager | #project-mgmt |

**Weekly Sync**: Mondays @ 10am (Slack huddle, 15 min)

---

## 🎯 IMMEDIATE NEXT STEPS (Today)

### For Core Dev
1. Read `PHASE_8_11_IMPLEMENTATION_GUIDE.md` § Domain Types
2. Review `Contest.swift` spec (23 fields)
3. Ask clarifying questions in #core-dev
4. **TODAY**: Start **8.1** (Contest.swift)

### For iOS Dev
1. Read `PHASE_8_11_IMPLEMENTATION_GUIDE.md` § ViewModels
2. Review ViewModel specs
3. Ask clarifying questions in #ios-dev
4. **WEDNESDAY**: Start **9.1** (AvailableContestsViewModel)

### For QA
1. Read `PHASE_8_11_IMPLEMENTATION_GUIDE.md` § Test Templates
2. Set up snapshot testing framework
3. Create test fixtures directory
4. **WEDNESDAY**: Start **10.1** (Domain mapping tests)

---

## 📊 PROGRESS TRACKING

Use this to track weekly progress:

```markdown
# Weekly Progress Report (Week X)

## Phase 8 Status
- Tasks Complete: 2/11
- Tests Passing: 70/90
- Blockers: [none | Contest struct incomplete | ...]
- ETA: On track / Delayed by X days

## Phase 9 Status
- Tasks Complete: 0/8
- iOS Build: ✓ Passing / ✗ Broken
- Blockers: Waiting on Phase 8

## Phase 10 Status
- Tasks Complete: 0/11
- Tests Written: 0
- CI/CD Setup: Not started
- Blockers: Waiting on Phase 8-9

## Phase 11 Status
- Tasks Complete: 0/10
- Blockers: Waiting on Phase 10

## Risks & Concerns
- [list any blockers or risks]

## Next Week
- [planned tasks]
```

---

**READY TO START? Begin with Phase 8 Day 1 checklist above.**

*Document: PHASE_8_11_QUICK_REFERENCE.md*
*For: 67 Enterprises Playoff Challenge Team*
*Authority: CLAUDE.md, PHASE_8_11_IMPLEMENTATION_GUIDE.md*

