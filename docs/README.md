# Welcome to Playoff Challenge Development

Welcome to the Playoff Challenge team. This documentation guides you through the governance infrastructure, frozen invariants, and development workflow for the fantasy football playoff app.

## What is Playoff Challenge?

Playoff Challenge is a fantasy football application where users pick NFL players and compete for prizes based on real-time performance during the NFL playoffs.

Users can:
- Pick players for each playoff week
- Track live scores during games
- View leaderboards and compete with friends
- Manage payment and prize distribution (backend-authoritative)

## System Architecture Overview

### Core Principles

This system operates under **Governance First** discipline:

1. **Frozen Invariants** — Protected by comprehensive test suites
   - Financial atomicity (wallet debit on join)
   - Lifecycle state machine (all 4 transitions)
   - Settlement snapshot binding
   - Mutation surface seal

2. **Golden Contracts** — Non-negotiable
   - `backend/contracts/openapi.yaml` — Public API contract (immutable hash)
   - `backend/db/schema.snapshot.sql` — Authoritative database schema
   - `CLAUDE.md` — Master governance instructions

3. **Architecture Boundaries** — Enforced at layer edges
   - DTO → Domain isolation (no DTOs in state)
   - ViewModel owns Service calls (not Views)
   - Time-based lock enforcement (not status-only)
   - Financial logic backend-authoritative (no client math)

## Tech Stack at a Glance

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **iOS App** | Swift / SwiftUI | Primary user interface |
| **Backend API** | Node.js / Express | REST API with contest lifecycle |
| **Database** | PostgreSQL (Railway) | Authoritative state store |
| **Test Suite** | Jest (Node) + Swift test | 1995+ backend tests, Swift unit tests |
| **External APIs** | ESPN, Sleeper | Live stats and player data |

## Repository Structure Overview

```
playoff-challenge/
├── docs/governance/                 ← GOLDEN REFERENCE (read first)
│   ├── CLAUDE_RULES.md             [✓] Global governance, frozen layers
│   ├── LIFECYCLE_EXECUTION_MAP.md   [✓] All state transitions
│   ├── FINANCIAL_INVARIANTS.md      [✓] Wallet & entry fee rules
│   ├── IOS_SWEEP_PROTOCOL.md        [✓] Layer boundary enforcement
│   └── ARCHITECTURE_ENFORCEMENT.md  [✓] Design system enforcement
├── backend/                         ← BACKEND SERVICE
│   ├── contracts/openapi.yaml       [✓] Public API contract (frozen)
│   ├── db/schema.snapshot.sql       [✓] Authoritative schema
│   ├── services/                    [✓] Domain logic (frozen primitives)
│   │   ├── contestLifecycleService.js
│   │   ├── customContestService.js
│   │   └── discovery/discoveryService.js
│   └── tests/                       [✓] 1995+ tests (invariant-locked)
│       ├── e2e/                     [✓] Lifecycle & settlement (frozen)
│       ├── discovery/               [✓] Cascade & ordering (117 tests)
│       └── services/                [✓] Financial & domain logic
├── ios-app/PlayoffChallenge/        ← iOS CLIENT
│   ├── Contracts/                   [✓] DTOs (OpenAPI-aligned)
│   ├── Services/                    [✓] HTTP + decode layer
│   ├── ViewModels/                  [✓] Domain ownership + business logic
│   ├── Views/                       [✓] Presentation only
│   └── Domain/                      [✓] Contest-specific rules
├── scripts/                         ← UTILITY & LAUNCH
│   ├── launch-claude.sh             [✓] System mode bootstrap
│   └── README.md                    [✓] Utility scripts reference
└── CLAUDE.md                        [✓] Master instructions

```

## Onboarding Journey (Governance-First)

Follow these sections **in order**. All development flows through governance layer.

### 0. Pre-Work: Understand System Scope

**Read these first (non-negotiable):**
- `docs/governance/CLAUDE_RULES.md` — Frozen vs evolving layers
- `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — All transitions
- `backend/contracts/openapi.yaml` — Public contract
- `backend/db/schema.snapshot.sql` — Schema authority

**Understand these boundaries:**
- Financial invariants are frozen (tests lock them)
- Lifecycle engine is frozen (4 atomic primitives)
- Mutation surface is sealed (only lifecycle service writes status)
- iOS architecture boundaries are non-negotiable

### 1. Prerequisites

docs/setup/Prerequisites.md

### 2. Development Environment Setup

- `docs/setup/Backend-Setup.md` — Node/PostgreSQL/Jest setup
- `docs/setup/iOS-Setup.md` — Xcode/Swift setup
- Scripts directory: `scripts/README.md`

### 3. Understanding System & Frozen Infrastructure

**Read these in order:**

1. `docs/architecture/Architecture-Deep-Dive.md` — System design
2. `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — State machine (all 4 transitions)
3. `docs/governance/FINANCIAL_INVARIANTS.md` — Wallet atomicity rules
4. `docs/governance/IOS_SWEEP_PROTOCOL.md` — Layer boundary enforcement

### 4. Working with Frozen Infrastructure

**Backend Changes:**
- All lifecycle transitions via `contestLifecycleService.js` (frozen primitives)
- All status mutations must pass frozen state machine tests
- Admin endpoints use sealed single-instance primitives
- Financial operations immutable once published

**iOS Changes:**
- Follow iOS Sweep Protocol (5 mandatory phases)
- Respect DTO → Domain → ViewModel → View boundary
- Use `lock_time` for entry enforcement (not status alone)
- No client-side financial math or score recalculation

**Test Validation (Required before merge):**
- All backend tests must pass
- OpenAPI freeze test validates contract stability
- No skipped or commented-out assertions
- No weakening of invariant tests

### 5. Making Changes

`docs/process/Making-Changes.md`

**Mandatory workflow:**
1. Read all governance files (hard gate)
2. Understand scope: frozen vs evolving layer
3. Write code + tests together
4. Run fast feedback tiers (Tier 1→2→3)
5. Update documentation if behavior changes
6. Verify all tests pass before committing

## Infrastructure Status (System Maturity Matrix)

### ✅ FROZEN (Protected by tests, non-negotiable)

| Component | Evidence | Status |
|-----------|----------|--------|
| **Financial Atomicity** | `joinContest()` with wallet lock | Tests: `customContest.service.test.js` |
| **Entry Fee Immutability** | DB trigger after publish | `schema.snapshot.sql` |
| **Lifecycle State Machine** | 4 atomic transitions | Tests: `contestLifecycleTransitions.integration.test.js`, `contestLifecycleCompletion.integration.test.js` |
| **Settlement Snapshot Binding** | `transitionLiveToComplete()` | Tests: `pgaSettlementInvariants.test.js` |
| **Mutation Surface** | All status via `contestLifecycleService` | Tests: `mutation-surface-seal.test.js` |
| **Discovery Cascade** | Phase 1→2→3 ordering | Tests: `discoveryService.cancellation.test.js` |
| **OpenAPI Contract** | `backend/contracts/openapi.yaml` | Freeze test: `openapi-freeze.test.js` |
| **Database Schema** | `backend/db/schema.snapshot.sql` | Authoritative source |

### 🔄 OPERATIONAL (Implemented, HA pending)

| Component | Details | Next Steps |
|-----------|---------|-----------|
| **Lifecycle Reconciler** | 30s poller, 3-phase orchestration | Monitoring + multi-instance HA |
| **Discovery Webhook** | Provider cancellation cascade | Event-driven enhancement |
| **Admin Operations** | Sealed mutation primitives | Formal OpenAPI documentation |

### 🔜 EVOLVING (Not yet started)

| Layer | Scope | Dependencies |
|-------|-------|--------------|
| **Contract Versioning Runtime** | Multi-version API routing | Frozen invariants (Phase 1) |
| **Tournament Discovery Automation** | Auto-template + external events | Frozen lifecycle (Phase 2) |
| **Advanced Monitoring** | Dashboards + alerts + SLOs | Operational layer (Phase 3) |

## Test Infrastructure

### Core Test Suites (Frozen Primitives)

**Backend** — Comprehensive test coverage across multiple suites:

| Suite | Purpose | Evidence |
|-------|---------|----------|
| **Lifecycle Transitions** | SCHEDULED→LOCKED→LIVE primitives | `contestLifecycleTransitions.integration.test.js` |
| **Lifecycle Completion** | LIVE→COMPLETE + snapshot binding | `contestLifecycleCompletion.integration.test.js` |
| **Settlement Isolation** | LIVE/CANCELLED independence | `cancellationSettlementIsolation.test.js` |
| **Admin Operations** | Sealed mutation primitives | `admin.contests.operations.test.js` |
| **Discovery Service** | Cascade + ordering + idempotency | `tests/discovery/` (multiple files) |
| **Financial Invariants** | Join + wallet + debit atomicity | `customContest.service.test.js` |
| **Contract Freeze** | OpenAPI immutability enforcement | `openapi-freeze.test.js` |

**iOS** — Swift unit tests:
- Layer boundary enforcement (DTO/ViewModel/View isolation)
- ViewModel computation correctness
- Service decoding validation

### Fast Feedback Tiers

Use these for rapid validation (don't run full suite on every change):

**Tier 1 — Discovery Surface**
```bash
cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/discovery/ --runInBand --forceExit
```

**Tier 2 — Settlement Invariants**
```bash
cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- tests/e2e/pgaSettlementInvariants.test.js --runInBand --forceExit
```

**Tier 3 — Full Backend Validation**
```bash
cd backend && \
ADMIN_JWT_SECRET=test-admin-jwt-secret \
TEST_DB_ALLOW_DBNAME=railway \
npm test -- --forceExit
```

**Before merge, always run Tier 3.**

## Operational Documentation

`docs/operations/` — Runbooks, incident response, troubleshooting.

## Release & Testing Documentation

`docs/implementations/` — Feature rollout, testing strategies, deployment procedures.

## Governance & AI Workflow

- `CLAUDE.md` — Master AI usage rules and discipline
- `docs/governance/` — All governance documents (7 files)
- `scripts/launch-claude.sh` — System mode bootstrap

## Quick Links

| Link | Purpose |
|------|---------|
| `CLAUDE.md` | Master rules (read first for any session) |
| `docs/governance/CLAUDE_RULES.md` | Global governance + frozen layers |
| `docs/governance/IOS_SWEEP_PROTOCOL.md` | iOS development structure |
| `backend/contracts/openapi.yaml` | Public API contract |
| Production API | https://playoffchallenge-production.up.railway.app |
| Health check | https://playoffchallenge-production.up.railway.app/health |

## Important Notes

### Security

- **Never commit secrets** — All secrets via Railway environment variables
- **Public repository** — Assume all code is visible
- **Database credentials** — Only in Railway, never in code

### Development Discipline

- **Governance first** — Read `CLAUDE_RULES.md` before any work
- **Test before code** — Failing tests define requirements
- **No weakened tests** — Fix implementation, not tests
- **Frozen contracts** — No breaking changes to OpenAPI or schema
- **Architecture boundaries** — Respect layer isolation

### Testing Requirements

- ✅ All backend tests must pass before merge
- ✅ OpenAPI freeze test validates contract
- ✅ No skipped tests
- ✅ No commented-out assertions
- ✅ Fast feedback tiers available for development loop

### Documentation is Part of the System

- Governance docs are **law**, not advisory
- Stale documentation is **architectural debt**
- Every session must improve or maintain clarity
- "Scout's rule" — Leave codebase cleaner than found

## Scout's Rule

**Leave the codebase cleaner than you found it:**

- [ ] Fix ambiguous comments
- [ ] Clarify governance docs if gaps found
- [ ] Update README if references become stale
- [ ] Remove obsolete feature references
- [ ] Add progress markers to scripts
- [ ] Document frozen vs evolving layers clearly

---

## Next Steps

1. **Read governance files** — Start with `docs/governance/CLAUDE_RULES.md`
2. **Understand system scope** — Which layer does your work touch?
3. **Review frozen infrastructure** — What can't you change?
4. **Set up development environment** — `docs/setup/` (Backend + iOS)
5. **Run fast feedback tiers** — Validate your changes quickly
6. **Make changes with discipline** — Respect boundaries, update tests, document decisions

---

**Last Updated:** March 2, 2026
**Governance Status:** System maturity matrix locked, frozen primitives protected
**Test Status:** All backend tests passing (run Tier 3 before merge)
**Critical Infrastructure:** ✅ All frozen layers operational
