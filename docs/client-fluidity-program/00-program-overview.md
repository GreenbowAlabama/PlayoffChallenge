# Client Fluidity Program
## 00: Program Overview

**Status:** PLANNED
**Last Updated:** 2026-02-16
**Owner:** Platform Architecture

---

## Executive Summary

The Client Fluidity Program enables onboarding of new contest types to production without requiring an iOS App Store update. This is achieved by moving contest-specific configuration and logic to the backend, establishing a lean presentation contract, and eliminating client-side business logic.

---

## Program Objective

**Primary Goal:**
Enable deployment of new contest types to production without iOS code changes, binary rebuilds, TestFlight cycles, or App Store submissions.

**Mechanism:**
- Backend exposes contest metadata, configuration, and leaderboard structure via Presentation Contract
- iOS consumes this contract as a presentation layer with zero business logic
- New contest types require no iOS modifications whatsoever

**Success Defined By:**
- Backend contract fully specified and tested (Iteration 01)
- iOS refactored to pure presentation layer (Iteration 02)
- New contest type onboarded and rendered without iOS changes (Iteration 03)
- All closure gates passed with zero defects

---

## Non-Goals

**Explicitly NOT in scope:**

- **Dynamic Layout Engine:** No UI abstraction, templating, or layout DSL
- **CMS System:** No content management, preview, or scheduling UI
- **Client-Side Rendering Engine:** No JSX-style component generation
- **Environment Switching:** All clients target staging baseURL (no staging/prod toggle)
- **Design System Versioning:** No client-server design system negotiation
- **Backward Compatibility Layers:** No legacy endpoint support beyond existing deprecation policy

**Why:**
Complexity beyond data contracts destroys maintainability and delays fluidity. We render server-provided data, period.

---

## Critical Invariant: iOS Binary Sequencing

**The iOS binary used to validate fluidity must be built and deployed prior to the introduction of the new contest type in backend.**

This ensures:
- No coordinated iOS deployment is required
- iOS can render the new type without changes
- The binary is frozen before backend changes
- Fluidity is verified independently

**Enforcement:**
- Document iOS binary version and build date before contest type introduction
- Verify new contest type uses only existing schema
- Confirm iOS code contains zero contest-type-specific logic
- No iOS commits allowed during contest type validation phase

---

## Definition of "Fluid"

A contest type is **Fluid** when:

1. **Schema exists** in `contest_instances` with contest_type, rules defined
2. **Backend exposes** contest metadata, configuration, and leaderboard structure via Presentation Contract
3. **iOS renders** without code changes by parsing server response
4. **No scoring logic** runs on client (verified by codebase audit)
5. **No payout logic** runs on client (verified by codebase audit)
6. **Action flags** respected by iOS (read-only, cannot join, etc.)
7. **Leaderboard columns** rendered dynamically from server schema
8. **Roster configuration** rendered dynamically from server schema
9. **New contest deployed** to production without iOS binary rebuild, TestFlight cycle, or App Store submission

---

## Architectural Boundaries

### Backend (Authoritative)
- Contest type definition and rules
- Scoring logic and calculation
- Payout table generation and calculation
- Leaderboard data assembly and column schema
- Roster configuration and constraints
- Entry state machine and lifecycle
- All state mutations

**Constraint:** No backend change may assume a single contest type or a single active contest.
**Constraint:** Multi-contest isolation is mandatory in all code paths.

### iOS (Presentation)
- Render contest metadata and branding
- Render leaderboard from server schema
- Render payout table from server data
- Render roster configuration from server schema
- Collect user input (joins, entries, selections)
- Display actions and state flags
- Send mutations to backend

**Constraint:** iOS must not compute scoring, payouts, or validate business logic.
**Constraint:** Unknown contest types must render using default presentation behavior without code modification.

### Presentation Contract (Data)
- JSON response schemas defined by iteration-01
- Leaderboard column types and rendering hints
- Roster field types and validation rules
- Action flags (read-only, full, closed, etc.)
- Contest metadata and state

**Constraint:** Contract is additive-only; no existing endpoint may break or change semantics.
**Constraint:** Contract changes require formal review before deployment.

### Program Scope
**What this program modifies:**
- Presentation boundaries only
- Contest rendering and display logic
- Data flow from backend to UI

**What this program does NOT modify:**
- Contest lifecycle transitions
- Settlement logic
- Payment logic
- Scoring logic
- Entry validation enforcement (server remains authoritative)
- Payout distribution algorithms

---

## Invariants Inherited from Hardening Program

1. **Multi-Contest is First-Class**
   - All API responses scoped by contest_id
   - No global state assumptions
   - Concurrent contests never interfere

2. **Contest Types are Pluggable**
   - Platform code must not hardcode sport or scoring rules
   - Contest logic defines entry shape, rules, scoring
   - Platform enforces lifecycle only

3. **Deterministic Scoring**
   - Scoring must be replayable from same inputs
   - Client must never attempt to replicate scoring
   - Re-runs must not create duplicate payouts

4. **Isolation is Mandatory**
   - Contest failure does not break platform
   - Fluidity in one contest type does not risk another

5. **No Schema Drift**
   - Contest table schema centralized and versioned
   - No client-side schema assumptions
   - Schema changes communicated via contract versioning

6. **No Lifecycle Drift**
   - Contest state machine owned by backend
   - Client respects state via action flags
   - No client-side state prediction or validation

---

## Closure Gates

**Iteration 01: Backend Contract Alignment MUST close when:**
- All checklist items in section 1 are complete
- All backend integration tests pass
- Swagger/OpenAPI spec matches JSON examples exactly
- Code review confirms zero breaking changes
- Platform Architecture approval obtained

**Iteration 02: iOS Contract Compliance MUST close when:**
- All checklist items in section 2 are complete
- All unit tests pass
- All integration tests pass
- Codebase audit confirms zero scoring/payout logic
- Code review confirms presentation-layer-only implementation
- Platform Architecture approval obtained

**Iteration 03: Fluidity Validation MUST close when:**
- All checklist items in section 3 are complete
- New contest type renders without iOS code changes
- All regression tests pass (zero failures)
- Zero crashes in TestFlight (if applicable)
- Zero blocker-severity defects
- Product Manager + Platform Architecture approval obtained

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Backend contract incomplete | Medium | High | Iteration-01 closure gate review |
| iOS rendering fails on new type | Medium | High | Comprehensive leaderboard rendering tests |
| Client-side logic still present | Low | High | Code audit and binary analysis |
| New contest type breaks existing | Low | High | Isolation testing in iteration-03 |
| Performance degradation | Low | Medium | Leaderboard query performance review |

---

## Dependency Chain

```
Iteration 01 (Backend Contract)
    ↓
Iteration 02 (iOS Compliance)
    ↓
Iteration 03 (Fluidity Validation)
    ↓
Production Deployment
```

Each iteration is a gate. Iteration-01 must close before iteration-02 begins.

---

## Documentation Ownership

- **This file (00-overview):** Program governance and objectives
- **01-iteration-01:** Backend contract specification and API design
- **02-iteration-02:** iOS refactoring and compliance requirements
- **03-iteration-03:** Validation and closure criteria

Service-specific documentation (scheduler, scoring engine) remains in respective service directories.

---

## Next Steps

1. Review and approve this overview
2. Proceed to iteration-01 for backend contract design
3. Align with current contest schema state
4. Define closure gate criteria for each iteration
