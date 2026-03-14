# Playoff Challenge Development

Welcome to the Playoff Challenge team. This documentation guides you through the governance infrastructure, frozen invariants, and development workflow.

## System Architecture Overview

### Core Principles

This system operates under **Governance First** discipline:

1. **Frozen Invariants** — Protected by comprehensive test suites
   - Financial atomicity (atomic operations on join)
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
| **Database** | PostgreSQL | Authoritative state store |
| **Test Suite** | Jest (Node) + Swift test | Comprehensive backend + client tests |
| **External APIs** | Multiple providers | Data integration |

## Repository Structure Overview

```
playoff-challenge/
├── docs/governance/                 ← GOLDEN REFERENCE (read first)
│   ├── CLAUDE_RULES.md             [✓] Global governance, frozen layers
│   ├── LIFECYCLE_EXECUTION_MAP.md   [✓] All state transitions
│   ├── FINANCIAL_INVARIANTS.md      [✓] Atomic operation rules
│   ├── IOS_SWEEP_PROTOCOL.md        [✓] Layer boundary enforcement
│   └── ARCHITECTURE_ENFORCEMENT.md  [✓] Design system enforcement
├── docs/archive/                    ← SUPERSEDED DOCS (historical reference only)
├── backend/                         ← BACKEND SERVICE
│   ├── contracts/openapi.yaml       [✓] Public API contract (frozen)
│   ├── db/schema.snapshot.sql       [✓] Authoritative schema
│   ├── services/                    [✓] Domain logic (frozen primitives)
│   └── tests/                       [✓] Comprehensive test coverage
│       ├── e2e/                     [✓] Lifecycle & settlement (frozen)
│       ├── governance/              [✓] Cascade & ordering
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

docs/setup/Prerequisites.md (if present)

### 2. Development Environment Setup

- Backend setup: See docs/setup/ or backend/README.md
- iOS setup: See ios-app/README.md or docs/setup/iOS-Setup.md
- Scripts directory: `scripts/README.md`

### 3. Understanding System & Frozen Infrastructure

**Read these in order:**

1. `docs/governance/CLAUDE_RULES.md` — Global governance, frozen layers
2. `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — State machine (all 4 transitions)
3. `docs/governance/FINANCIAL_INVARIANTS.md` — Atomic operation rules
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
| **Financial Atomicity** | Atomic operations with wallet locking | Test-locked |
| **Entry Fee Immutability** | DB trigger after publish | `schema.snapshot.sql` |
| **Lifecycle State Machine** | 4 atomic transitions | Test-locked across all transitions |
| **Settlement Snapshot Binding** | `transitionLiveToComplete()` | Test-locked |
| **Mutation Surface** | All status via `contestLifecycleService` | Test-locked |
| **Provider Cascade** | Phase 1→2→3 ordering | Test-locked |
| **OpenAPI Contract** | `backend/contracts/openapi.yaml` | Freeze test: immutable hash |
| **Database Schema** | `backend/db/schema.snapshot.sql` | Authoritative source |

### 🔄 OPERATIONAL (Implemented, HA pending)

| Component | Details | Next Steps |
|-----------|---------|-----------|
| **Lifecycle Reconciler** | Automatic state machine orchestration | Monitoring + multi-instance HA |
| **Provider Pipeline** | Cascade & state transition automation | Event-driven enhancement |
| **Admin Operations** | Sealed mutation primitives | Formal OpenAPI documentation |

### 🔜 EVOLVING (Design phase)

| Layer | Scope | Dependencies |
|-------|-------|--------------|
| **Contract Versioning Runtime** | Multi-version API routing | Frozen invariants (Phase 1) |
| **Tournament Automation** | Auto-template + external events | Frozen lifecycle (Phase 2) |
| **Advanced Monitoring** | Dashboards + alerts + SLOs | Operational layer (Phase 3) |

## Test Infrastructure

### Core Test Suites (Frozen Primitives)

**Backend** — Comprehensive test coverage:

| Suite | Purpose |
|-------|---------|
| **Lifecycle Transitions** | State machine transitions (SCHEDULED→LOCKED→LIVE→COMPLETE) |
| **Lifecycle Completion** | Settlement + snapshot binding |
| **Settlement Isolation** | Multi-contest independence |
| **Admin Operations** | Sealed mutation primitives |
| **Governance Layer** | Cascade ordering + idempotency |
| **Financial Integrity** | Join + wallet + debit atomicity |
| **Contract Freeze** | OpenAPI immutability enforcement |

**iOS** — Swift unit tests:
- Layer boundary enforcement (DTO/ViewModel/View isolation)
- ViewModel computation correctness
- Service decoding validation

### Fast Feedback Tiers

Use these for rapid validation (don't run full suite on every change):

**Tier 1 — Governance Surface**
```bash
cd backend && \
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-test-admin-jwt-secret} \
TEST_DB_ALLOW_DBNAME=${TEST_DB_ALLOW_DBNAME:-railway} \
npm test -- tests/governance/ --runInBand --forceExit
```

**Tier 2 — Frozen Invariants**
```bash
cd backend && \
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-test-admin-jwt-secret} \
TEST_DB_ALLOW_DBNAME=${TEST_DB_ALLOW_DBNAME:-railway} \
npm test -- tests/e2e/ --runInBand --forceExit
```

**Tier 3 — Full Backend Validation**
```bash
cd backend && \
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-test-admin-jwt-secret} \
TEST_DB_ALLOW_DBNAME=${TEST_DB_ALLOW_DBNAME:-railway} \
npm test -- --forceExit
```

**Before merge, always run Tier 3.**

## Operational Documentation

`docs/operations/` — Runbooks, incident response, troubleshooting (if present).

## Governance & AI Workflow

- `CLAUDE.md` — Master AI usage rules and discipline
- `docs/governance/` — All governance documents (5 files)
- `scripts/launch-claude.sh` — System mode bootstrap

## Quick Links

| Link | Purpose |
|------|---------|
| `CLAUDE.md` | Master rules (read first for any session) |
| `docs/governance/CLAUDE_RULES.md` | Global governance + frozen layers |
| `docs/governance/IOS_SWEEP_PROTOCOL.md` | iOS development structure |
| `docs/api/contests-endpoints.md` | REST API endpoint specifications |
| `backend/contracts/openapi.yaml` | Public API contract |
| `docs/architecture/ESPN-PGA-Ingestion.md` | ESPN data fetching strategy (scoreboard-based) |
| `docs/production-readiness/DISCOVERY_SYSTEM.md` | Tournament discovery cycle |

## Important Notes

### Security

- **Never commit secrets** — All secrets via environment variables
- **Public repository** — Assume all code is visible
- **Database credentials** — Only in env vars, never in code

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
4. **Set up development environment** — See setup docs
5. **Run fast feedback tiers** — Validate your changes quickly
6. **Make changes with discipline** — Respect boundaries, update tests, document decisions

---

**Last Updated:** March 2, 2026
**Governance Status:** System maturity matrix locked, frozen primitives protected
**Test Status:** All backend tests passing (run Tier 3 before merge)
**Critical Infrastructure:** ✅ All frozen layers operational
