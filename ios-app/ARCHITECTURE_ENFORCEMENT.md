# Architecture Enforcement & PR Review Guide

**Authority**: ARCHITECTURE.md is the reference. This document is the enforcement toolkit.

---

## PR Template Addition

Add to GitHub PR description (enforce before merge):

```markdown
## Architecture Compliance

- [ ] **Layer Boundaries**: All `@Published` properties are Domain types only
- [ ] **Service Injection**: ViewModels depend ONLY on Service Protocols, not concrete types
- [ ] **Contract Isolation**: No DTOs or Contracts exposed in ViewModel state
- [ ] **Domain Purity**: No optional fields in Domain types, no inference/fabrication
- [ ] **Protocol Returns**: Service protocols return Domain types exclusively
- [ ] **Test Isolation**: Mocks inject Protocols, return Domain stubs

**If any box is unchecked, request changes before merge.**
```

---

## Build-Time Checks

### 1. Forbidden Import Detection

Run in CI/CD before merge:

```bash
#!/bin/bash
# Check for DTO/Contract imports in ViewModels
echo "Scanning for forbidden imports in ViewModels..."

FORBIDDEN_IMPORTS=(
    "import ContestDetailResponseContract"
    "import ContestListItemDTO"
    "import LeaderboardResponseContract"
    "import PayoutTierContract"
    "import RosterConfigContract"
)

ERROR_COUNT=0
for pattern in "${FORBIDDEN_IMPORTS[@]}"; do
    FOUND=$(grep -r "$pattern" ios-app/PlayoffChallenge/*/ViewModels/ 2>/dev/null | wc -l)
    if [ $FOUND -gt 0 ]; then
        echo "❌ VIOLATION: Contract import found in ViewModel"
        grep -r "$pattern" ios-app/PlayoffChallenge/*/ViewModels/
        ((ERROR_COUNT++))
    fi
done

# Check for concrete service imports in ViewModels
echo "Scanning for concrete service imports in ViewModels..."
FOUND=$(grep -r "private let.*Service: [A-Z].*Service" ios-app/PlayoffChallenge/*/ViewModels/*.swift 2>/dev/null | grep -v "protocol" | wc -l)
if [ $FOUND -gt 0 ]; then
    echo "❌ VIOLATION: Concrete service type in ViewModel"
    grep -r "private let.*Service: [A-Z].*Service" ios-app/PlayoffChallenge/*/ViewModels/*.swift
    ((ERROR_COUNT++))
fi

if [ $ERROR_COUNT -gt 0 ]; then
    echo "❌ Architecture violations detected: $ERROR_COUNT"
    exit 1
else
    echo "✅ No forbidden imports detected"
    exit 0
fi
```

### 2. Swift Build Verification

```bash
#!/bin/bash
# Verify core package and iOS app both compile
echo "Building core package..."
cd core
swift build -c release || { echo "❌ Core build failed"; exit 1; }
swift test || { echo "❌ Core tests failed"; exit 1; }
cd ..

echo "Building iOS app..."
cd ios-app/PlayoffChallenge
swift build -c release || { echo "❌ iOS build failed"; exit 1; }
cd ..

echo "✅ All builds passed"
exit 0
```

### 3. Optional Field Detection

Add to test suite (Core package):

```swift
// core/Tests/coreTests/ArchitectureTests.swift
import XCTest
@testable import core

final class ArchitectureTests: XCTestCase {

    /// Verify no Domain types have optional non-error fields
    func testContestActionStateHasNoOptionalFields() {
        let state = ContestActionState(
            contestId: "123",
            leaderboardState: .open,
            actions: ContestActions(
                canJoin: true,
                canDelete: false,
                canUnjoin: false,
                canEditEntry: false,
                isClosed: false
            ),
            payout: [],
            roster: [:]
        )

        // If this compiles without defaults, no optionals exist in init
        XCTAssertNotNil(state.contestId)
    }

    /// Verify Contract decode fails on missing required fields
    func testContestDetailContractDecodingRequiresAllFields() throws {
        let invalidJSON = """
        {
            "contest_id": "123",
            "type": "nba"
        }
        """

        let data = invalidJSON.data(using: .utf8)!

        // Must throw — payout_table is required
        XCTAssertThrowsError(
            try JSONDecoder().decode(ContestDetailResponseContract.self, from: data)
        )
    }

    /// Verify Contract → Domain mapping is strict, no inference
    func testMappingContractToDomainPreservesBackendTruth() throws {
        let contract = ContestDetailResponseContract(
            contest_id: "123",
            type: "nba",
            leaderboard_state: .open,
            actions: ContestActions(
                canJoin: false,
                canDelete: false,
                canUnjoin: false,
                canEditEntry: true,
                isClosed: false
            ),
            payout_table: [
                PayoutTierContract(place: 1, payout: 100)
            ],
            roster_config: [:]
        )

        // Map: strict, no inference
        let domain = ContestActionState(
            contestId: contract.contest_id,
            leaderboardState: contract.leaderboard_state,
            actions: contract.actions,
            payout: contract.payout_table.map { PayoutTier(place: $0.place, payout: $0.payout) },
            roster: contract.roster_config
        )

        // Verify backend truth is preserved
        XCTAssertEqual(domain.actions.canJoin, false)
        XCTAssertEqual(domain.actions.canEditEntry, true)
    }
}
```

---

## Code Review Checklist

### ViewModel Review

**Checklist for reviewers:**

```
FORBIDDEN in ViewModel:
☐ No `ContestDetailResponseContract` import
☐ No `ContestListItemDTO` import
☐ No `ContestDetailService` import (must be protocol only)
☐ No `@State var dto: ...`
☐ No optional Domain fields (e.g., `name: String?`)
☐ No inference logic (e.g., `canJoin: Bool { actions != nil && actions.can_join }`)
☐ No direct Backend API calls (all via injected Protocol)

REQUIRED in ViewModel:
☐ `@Published` properties are Domain types (Contest, ContestActionState, etc.)
☐ Service dependency is protocol-typed: `private let service: ContestDetailFetching`
☐ Service returned values map Contract → Domain before publishing
☐ All backend truth comes from fetched data, never inferred

Example Pass:
@Published var actionState: ContestActionState?
private let detailFetcher: ContestDetailFetching

Example Fail:
@Published var contract: ContestDetailResponseContract?
private let service: ContestDetailService
```

### Service Protocol Review

**Checklist for reviewers:**

```
REQUIRED:
☐ Protocol return type is Domain type, never Contract/DTO
☐ Protocol parameter types are Domain or Primitives
☐ Concrete implementation is `internal` or `fileprivate`
☐ Mapping Contract → Domain happens in implementation, not exposed

Example Pass:
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState
}

Example Fail:
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestDetailResponseContract
}
```

### View Review

**Checklist for reviewers:**

```
FORBIDDEN in View:
☐ No direct @State with DTO/Contract
☐ No direct service import
☐ No direct API calls
☐ No backend knowledge

REQUIRED in View:
☐ Receives state only from ViewModel binding
☐ Calls only ViewModel methods (no arguments)
☐ All data displayed is Domain type (from ViewModel)

Example Pass:
@EnvironmentObject var vm: ContestDetailViewModel
if vm.canJoinContest { Button("Join") { Task { await vm.joinContest() } } }

Example Fail:
@State var contract: ContestDetailResponseContract?
APIService.shared.fetchContest(id: contestId) { contract = $0 }
```

---

## Common Violations & Fixes

### Violation #1: DTO in Published State

**Detected By**: Import scanning + manual review

```swift
// ❌ WRONG
@Published var contract: ContestDetailResponseContract?

// ✅ CORRECT
@Published var actionState: ContestActionState?
```

**Fix**:
1. Create Domain type in Core
2. Map Contract → Domain in Service
3. Publish Domain type

---

### Violation #2: Concrete Service in ViewModel

**Detected By**: Import scanning + manual review

```swift
// ❌ WRONG
private let service: ContestDetailService

// ✅ CORRECT
private let service: ContestDetailFetching
```

**Fix**:
1. Define protocol for service
2. Inject protocol into ViewModel
3. Keep concrete type internal to service module

---

### Violation #3: Optional Domain Fields

**Detected By**: Compilation + tests

```swift
// ❌ WRONG
struct Contest {
    let id: String
    let name: String?  // Optional—why?
    let status: String?
}

// ✅ CORRECT
struct Contest {
    let id: String
    let name: String  // Required—backend always sends
    let status: ContestStatus  // Enum, never optional
}
```

**Fix**:
1. Check contract—field required or optional?
2. If required from backend, remove optional
3. If optional from backend, decode fails strictly (no fallback)

---

### Violation #4: Inferred Domain Fields

**Detected By**: Manual code review + tests

```swift
// ❌ WRONG — ViewModel infers state
var canJoin: Bool {
    actionState != nil && actionState.actions.canJoin
}

// ✅ CORRECT — use backend field directly
var canJoin: Bool {
    actionState?.actions.canJoin ?? false
}
```

**Fix**:
1. Always trust backend field
2. No complex inference
3. If backend doesn't provide flag, request it

---

## Test Requirements

### Unit Test Pattern

```swift
// ViewModel Test: Inject mock protocol, verify Domain published
@MainActor
final class ContestDetailViewModelTests: XCTestCase {

    func testFetchPublishesContestActionState() async {
        let expectedState = ContestActionState.stub()
        let mock = MockContestDetailFetching { expectedState }

        let vm = ContestDetailViewModel(
            contestId: UUID(),
            detailFetcher: mock  // ← Protocol, not concrete
        )

        await vm.fetchContestDetail()

        // Verify Domain type published
        XCTAssertEqual(vm.actionState, expectedState)
    }
}

// Service Test: Verify Contract → Domain mapping
final class ContestDetailServiceTests: XCTestCase {

    func testMapsContractToDomain() async throws {
        let contract = ContestDetailResponseContract.stub()
        let service = ContestDetailService(mockFetcher: { contract })

        let domain = try await service.fetchContestActionState(contestId: UUID())

        // Verify mapping preserves backend truth
        XCTAssertEqual(domain.contestId, contract.contest_id)
        XCTAssertEqual(domain.leaderboardState, contract.leaderboard_state)
    }
}
```

---

## Git Hooks (Optional)

Add pre-commit hook to catch violations early:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Prevent commit if forbidden imports detected
FORBIDDEN_PATTERNS=(
    "ContestDetailResponseContract"
    "ContestListItemDTO"
    "LeaderboardResponseContract"
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    FOUND=$(git diff --cached --name-only | xargs grep -l "$pattern" 2>/dev/null | grep -i viewmodel | wc -l)
    if [ $FOUND -gt 0 ]; then
        echo "❌ Pre-commit violation: DTO/Contract import in ViewModel"
        echo "Run: git diff --cached | grep '$pattern'"
        exit 1
    fi
done

exit 0
```

---

## Documentation Updates

### CLAUDE.md Additions

```markdown
## iOS Architecture Rules

### Layer Isolation
- Views depend ONLY on ViewModels
- ViewModels depend ONLY on Service Protocols (injected)
- Services decode Contracts, return Domain
- No DTO/Contract exposed above Service layer

### Protocol Boundaries
- All service protocols return Domain types
- All ViewModel @Published are Domain types
- No exceptions — enforce at import time

### Testing
- Mock services via Protocol, never concrete type
- Verify Domain type returned, not DTO
- Test Contract → Domain mapping in Core

### Build Enforcement
- `swift build` must pass with no warnings
- `swift test` must pass in Core (Contract decoders verified)
- CI/CD scans for forbidden imports before merge
```

---

## Metrics & Monitoring

Track architectural health:

```
Metric: Forbidden Imports
- Target: 0 per week
- Detect: DTO/Contract import in ViewModel
- Action: Reject PR, guide to correct pattern

Metric: Protocol Injection Rate
- Target: 100% of service dependencies
- Detect: Concrete service type import in ViewModel
- Action: Enforce protocol-first injection

Metric: Domain Type Coverage
- Target: 100% of ViewModel @Published
- Detect: DTO/Contract in @Published
- Action: Create Domain type, add to test suite

Metric: Optional Field Violations
- Target: 0 per sprint
- Detect: Optional field in Domain type
- Action: Update Domain type, add test
```

---

## FAQ

**Q: Can I put a DTO in ViewModel if it's internal?**
A: No. Never. DTOs are transport contracts. Use Domain types for all application state.

**Q: Can I inject a concrete service if there's only one implementation?**
A: No. Protocol injection enables testing and future extensibility. One implementation now ≠ one forever.

**Q: Should I add optional fields to Domain for "flexibility"?**
A: No. If backend doesn't send it, the contract should fail to decode. If it does send it, it's required in Domain.

**Q: Can ViewModels call other ViewModels?**
A: No. ViewModels depend only on Service Protocols. Use composition or shared service dependencies.

**Q: Can Views access Services directly?**
A: No. Views depend only on ViewModels. All backend access is through ViewModel.

---

**Document Version**: VALIDATION 4 Enforcement
**Last Updated**: 2026-02-23
**Status**: Active
