# VALIDATION 4 — Architecture Lock Documentation

**Authority**: Core package is authoritative. Domain types are immutable, single-source-of-truth endpoints.
**Scope**: iOS client layering, dependency rules, protocol boundaries, mapping contracts.
**Enforcement**: PR review checklist. Build/test rules. Test-driven failure detection.

---

## Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Views (SwiftUI)                       │
│           (Receive Domain types only, read-only)         │
└────────────────────┬────────────────────────────────────┘
                     │ Observe: @Published Domain types
                     │ Call: ViewModel methods (no args)
                     ↓
┌─────────────────────────────────────────────────────────┐
│              ViewModels (ObservableObject)               │
│      (@Published: Domain types ONLY, no DTOs)           │
│      (Protocol injection: abstract services only)        │
└────────────────────┬────────────────────────────────────┘
                     │ Fetch via Protocol
                     │ Decode: DTO → Domain
                     │ Publish: Domain
                     ↓
┌─────────────────────────────────────────────────────────┐
│           Services (Protocol-first)                      │
│    (Decodable: DTOs, Return: Domain only)              │
│    (Concrete: package-internal, never injected)        │
└────────────────────┬────────────────────────────────────┘
                     │ Decode: Contracts
                     │ Map: Contract → Domain
                     │ Return: Domain
                     ↓
┌─────────────────────────────────────────────────────────┐
│      Contracts (core package, canonical DTOs)           │
│      (Codable: network shape, endpoint-specific)        │
│      (Never mutated, never cached as state)             │
└─────────────────────────────────────────────────────────┘
```

---

## Allowed Dependency Directions

**STRICT RULES** — violations detected in PR review and build.

```
Views         → ViewModels (only)
ViewModels    → Service Protocols (only)
Services      → Contracts (only)
Contracts     → Foundation (only)

Domain        ← Services (returned type)
Domain        ← ViewModels (@Published)
Domain        ← Views (received via binding)
Domain        ← Protocols (return type signature)
```

### What This Means

| Layer       | CAN depend on | CANNOT depend on |
|-------------|---------------|-----------------|
| **Views** | ViewModels (by injection), Domain (from ViewModel) | Services (concrete), DTOs, Contracts |
| **ViewModels** | Service Protocols, Domain | Concrete services, DTOs, Contracts, other ViewModels |
| **Services (impl)** | Contracts, Foundation, URLSession | DTOs (except Contracts), Domain, ViewModels |
| **Contracts** | Foundation, Codable | Domain, Services, anything above |

---

## Forbidden Patterns

### ❌ FORBIDDEN #1: DTO in ViewModel State

```swift
// WRONG
@Published var contract: ContestDetailResponseContract?

// CORRECT
@Published var contest: ContestActionState?
```

**Why**: ViewModels own domain state, not network shape. Contracts leak backend details to Views.

---

### ❌ FORBIDDEN #2: Concrete Service Type in ViewModel

```swift
// WRONG
private let service: ContestDetailService

// CORRECT
private let service: ContestDetailFetching  // Protocol only
```

**Why**: Testability, abstraction, loose coupling. Concrete type hides the protocol contract.

---

### ❌ FORBIDDEN #3: Fabricated Domain Fields

```swift
// WRONG — ViewModel invents field not from backend
var isJoinable: Bool {
    actionState != nil && actionState.actions.canJoin
}

// CORRECT — fetch full state from backend, use backend field directly
var joinable: Bool {
    actionState?.actions.canJoin ?? false
}
```

**Why**: Backend is authoritative. Client inference breaks determinism and introduces bugs.

---

### ❌ FORBIDDEN #4: Domain Type with Optional Fields

```swift
// WRONG
struct Contest {
    let id: String
    let name: String?          // Should never be optional
    let status: String?        // Backend always provides
}

// CORRECT — all required fields present in contract
struct Contest {
    let id: String
    let name: String
    let status: ContestStatus
}
```

**Why**: Ambiguity in Views. If backend doesn't send it, the contract should fail to decode.

---

### ❌ FORBIDDEN #5: View Direct Backend Observation

```swift
// WRONG
@State var contest: ContestDetailResponseContract?

// CORRECT
@EnvironmentObject var viewModel: ContestDetailViewModel
// Observe viewModel.contest (Domain type)
```

**Why**: Views depend on ViewModels for state isolation, reusability, and testability.

---

### ❌ FORBIDDEN #6: Mutation in Service Layer

```swift
// WRONG — returns nothing, side effect implicit
func joinContest() throws { ... }

// CORRECT — explicit return or throwing error
func joinContest() throws -> JoinResponse { ... }
```

**Why**: Testability, predictability. Side effects must be observable via return type.

---

## Protocol Boundary Rules

### Service Protocols: Only Return Domain

```swift
// CORRECT
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState
}

// WRONG — returns DTO/Contract
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestDetailResponseContract
}
```

**Why**: Protocol defines the contract to ViewModels. ViewModels must receive Domain types, never raw network shapes.

---

### Protocol Parameter Types: Accept Domain or Primitive

```swift
// CORRECT
protocol ContestJoining {
    func joinContest(contestId: UUID, token: String, userId: UUID) async throws -> JoinResponse
}

// ACCEPTABLE (if Codable is Domain boundary)
protocol ContestJoining {
    func joinContest(request: JoinRequest) async throws -> JoinResponse
}

// WRONG — DTO input parameter
protocol ContestJoining {
    func joinContest(dto: ContestJoinDTO) async throws -> ContestJoinResponseDTO
}
```

**Why**: Parameters should be Domain or explicit primitives, never transport contracts.

---

## Mapping Rules

### Unidirectional: DTO → Domain → ViewModel → View

```
Network Response (DTO)
    ↓ (decode in Service)
Contract ← JSON decoder (strict, all fields required)
    ↓ (map in Service)
Domain ← ViewModel receives from service
    ↓ (@Published in ViewModel)
View reads Domain (never sees DTO)
```

---

### Concrete Mapping Pattern

```swift
// Service implementation — NEVER exposed via protocol
final class ContestDetailService: ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState {
        let contract = try await fetchContract(for: contestId)
        // Map: strict, no inference, backend-driven
        return ContestActionState(
            contestId: contract.contest_id,
            leaderboardState: contract.leaderboard_state,
            actions: ContestActions(
                canJoin: contract.actions.can_join,
                canDelete: contract.actions.can_delete,
                canUnjoin: contract.actions.can_unjoin,
                canEditEntry: contract.actions.can_edit_entry,
                isClosed: contract.actions.is_closed
            ),
            payout: contract.payout_table.map { tier in
                PayoutTier(
                    place: tier.place,
                    payout: tier.payout
                )
            },
            roster: contract.roster_config
        )
    }
}

// ViewModel — receives Domain only
@Published var actionState: ContestActionState?

// View — reads Domain
if actionState.actions.canJoin { ... }
```

---

## Domain Type Definitions

**Authority**: Core package defines all Domain types. iOS does not invent Domain types outside Core.

### Required Domain Types (from Core)

| Domain Type | Source | Usage |
|-------------|--------|-------|
| `ContestActionState` | `core/Domain/` | ViewModel published state |
| `ContestActions` | `core/Domain/` | Determines UI capability flags |
| `LeaderboardState` | `core/Contracts/` | Contest leaderboard visibility |
| `PayoutTier` | `core/Domain/` | Payout table display |
| `Leaderboard` | `core/Domain/` | Leaderboard data fetch |

### Example Domain Type Structure

```swift
// core/Sources/core/Domain/ContestActionState.swift
public struct ContestActionState: Hashable {
    public let contestId: String
    public let leaderboardState: LeaderboardState
    public let actions: ContestActions
    public let payout: [PayoutTier]
    public let roster: RosterConfigContract
}

public struct ContestActions: Hashable {
    public let canJoin: Bool
    public let canDelete: Bool
    public let canUnjoin: Bool
    public let canEditEntry: Bool
    public let isClosed: Bool
}
```

---

## Test & Build Rules

### Swift Build Enforcement

```bash
# Core package must build with no warnings, all tests pass
cd core
swift build
swift test

# iOS app must compile with strict dependency checks
cd ios-app/PlayoffChallenge
swift build

# Compilation will fail if:
# - ViewModel imports concrete Service type (not protocol)
# - View imports DTO/Contract directly
# - Service returns DTO instead of Domain via protocol
```

### Test Harness

```swift
// CORRECT — Protocol injection for test
class MockContestDetailFetching: ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState {
        return .stub()  // Domain type stub, not contract
    }
}

// ViewModel test
let vm = ContestDetailViewModel(
    contestId: UUID(),
    detailFetcher: MockContestDetailFetching()
)

// WRONG — injecting concrete type defeats isolation
let vm = ContestDetailViewModel(
    contestId: UUID(),
    detailFetcher: ContestDetailService()  // ❌ No—use protocol
)
```

---

## Definition of Done Checklist

### Code Changes

- [ ] **All new Domain types defined in Core**, not iOS app
- [ ] **No DTOs or Contracts in ViewModel @Published**
- [ ] **All service dependencies injected as Protocols**, never concrete types
- [ ] **Services map Contract → Domain before returning**
- [ ] **No Domain type has optional fields** (required from backend, strict decode)
- [ ] **No logic infers or fabricates Domain fields** (backend authoritative)
- [ ] **Views receive Domain types only**, never DTOs

### Service Protocol Contracts

- [ ] **Protocol returns Domain types only**, not Contracts
- [ ] **Protocol input parameters are Domain or Primitives**, not DTOs
- [ ] **Service implementation is never directly imported** (only protocol)
- [ ] **Concrete services stay package-internal** (mark `internal` or file-private)

### Testing

- [ ] **ViewModel tests inject mock Protocol**, not concrete service
- [ ] **Mock service returns Domain types** (stubs, not contracts)
- [ ] **No mocking of ViewModel state** (only services mocked)
- [ ] **Core package tests verify Contract → Domain mapping**

### Build & Lint

- [ ] **`swift build` succeeds in Core and iOS app**
- [ ] **`swift test` passes in Core** (contract decoders verified)
- [ ] **No import warnings** (`Foundation` only in contracts, `core` in services/viewmodels)
- [ ] **No unused imports** (each import layer is intentional)

---

## Violation Detection

### Compile-Time Catches

| Violation | Caught By |
|-----------|-----------|
| ViewModel imports concrete `ContestDetailService` | Import statement (manual review) |
| View imports `ContestDetailResponseContract` | Import statement (manual review) |
| Service returns `ContestDetailResponseContract` | Protocol signature mismatch |
| Domain type with optional fields | Test: decoding with missing field must fail |

### Runtime Catches (Tests)

```swift
// Test: Service must return Domain, not Contract
func testServiceReturnsContestActionState() async throws {
    let result = try await service.fetchContestActionState(contestId: UUID())
    // result must be ContestActionState, not ContestDetailResponseContract
    XCTAssertNotNil(result.leaderboardState)
    XCTAssertNotNil(result.actions)
}

// Test: Missing backend field must fail decode
func testContractDecodeFailsOnMissingField() throws {
    let json = """
    { "contest_id": "123", "type": "nba" }
    """
    // Should throw — payout_table required
    XCTAssertThrowsError(
        try JSONDecoder().decode(ContestDetailResponseContract.self, from: json.data(using: .utf8)!)
    )
}

// Test: ViewModel publishes Domain, not DTO
func testViewModelPublishesContestActionState() async {
    let vm = ContestDetailViewModel(
        contestId: UUID(),
        detailFetcher: mockFetcher
    )
    await vm.fetchContestDetail()

    // vm.actionState must be ContestActionState, not Contract
    XCTAssertIsNotNil(vm.actionState as? ContestActionState)
}
```

---

## PR Review Checklist

**Reviewers: Apply these checks before approval.**

### Layer Boundaries

- [ ] Are all `@Published` properties Domain types (or primitives)? No DTOs, no Contracts.
- [ ] Does ViewModel depend **only** on Service **protocols**, never concrete types?
- [ ] Does Service implementation receive Contract, return Domain?
- [ ] Does View depend only on ViewModel, never Services directly?

### Protocol Contracts

- [ ] Does the service protocol return Domain types?
- [ ] Do protocol methods avoid DTO/Contract in signatures?
- [ ] Is the concrete service marked `internal` (or not imported in tests)?

### Domain Purity

- [ ] Are all Domain types defined in Core or imported from Core?
- [ ] Does any Domain type have optional fields? (Should not—backend is authoritative.)
- [ ] Does ViewModel or View infer/fabricate state? (Should not—use backend field directly.)

### Testing

- [ ] Do ViewModel tests inject mock **Protocols**, not concrete services?
- [ ] Does the mock return Domain stubs, not contracts?
- [ ] Does Core have round-trip tests: JSON → Contract → Domain?

### Build

- [ ] Does `swift build` pass with no warnings?
- [ ] Does `swift test` pass in Core?

---

## Glossary

| Term | Definition |
|------|-----------|
| **Contract (DTO)** | Network response shape, codable from JSON, endpoint-specific. Defined in `core/Contracts/`. Never cached or published by Views. |
| **Domain** | Application data model, decoupled from network shape, endpoint-agnostic. Immutable, authoritative, published by ViewModels. |
| **Service Protocol** | Abstract interface, returns Domain, injected into ViewModels. Enables testing via mocks. |
| **Service Implementation** | Concrete class, decodes Contract, maps to Domain, stays internal. Never imported in Views or tests directly. |
| **ViewModel** | State owner, publishes Domain types, calls Service Protocols. Bridge between Views and Services. |
| **View** | SwiftUI, receives Domain via ViewModel, no backend knowledge. Purely presentational. |

---

## References

- **Core Package Authority**: `/core/Sources/core/Contracts/` (network contracts)
- **Service Protocols**: `/ios-app/PlayoffChallenge/*/Protocols/`
- **Service Implementations**: `/ios-app/PlayoffChallenge/*/Services/`
- **ViewModels**: `/ios-app/PlayoffChallenge/*/ViewModels/`
- **Views**: `/ios-app/PlayoffChallenge/*/Views/`

---

**Document Version**: VALIDATION 4
**Last Updated**: 2026-02-23
**Authority**: iOS Architecture Lead
**Status**: Enforced
