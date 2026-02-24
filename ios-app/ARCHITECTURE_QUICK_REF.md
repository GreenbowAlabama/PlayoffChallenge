# Architecture Quick Reference

**One-page reference for iOS architecture enforcement. Laminate this. Pin it. Review with every PR.**

---

## Dependency Diagram (The Law)

```
Views          ← ViewModels        ← Service Protocols   ← Contracts
  ↑              ↑                   ↑
  |__Domain______|_Domain___________|_Domain___
                                       ↑
                                   (Core Package)
```

---

## Layer Rules (Memorize These)

| Layer | `@Published` | Imports | Can Call |
|-------|------|---------|----------|
| **View** | Domain | ViewModel only | ViewModel methods |
| **ViewModel** | Domain | Protocols only | Service Protocols |
| **Service (impl)** | — | Contracts | URLSession, Foundation |
| **Contracts** | — | Foundation | Codable |

---

## The 5 Forbidden Things

```
❌ @Published var contract: ContestDetailResponseContract?
❌ private let service: ContestDetailService
❌ struct Contest { name: String? }         // Why optional?
❌ var canJoin: Bool { actions != nil && ... }  // Infer? No.
❌ APIService.shared.fetch()    // Direct call in View
```

---

## The 5 Required Things

```
✅ @Published var actionState: ContestActionState?
✅ private let service: ContestDetailFetching       // Protocol
✅ struct Contest { name: String }                   // Required
✅ actionState?.actions.canJoin ?? false             // Trust backend
✅ Task { await vm.joinContest() }                   // Via ViewModel
```

---

## Service Protocol Template

```swift
protocol ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState
    //                                                        ↑ DOMAIN TYPE (never Contract)
}

// Implementation (internal only)
final class ContestDetailService: ContestDetailFetching {
    func fetchContestActionState(contestId: UUID) async throws -> ContestActionState {
        let contract = try await decode(ContestDetailResponseContract.self)
        return ContestActionState(
            contestId: contract.contest_id,
            actions: contract.actions,
            // ... strict mapping
        )
    }
}
```

---

## ViewModel Template

```swift
@MainActor
final class ContestDetailViewModel: ObservableObject {
    @Published var actionState: ContestActionState?  // ← Domain type

    private let detailFetcher: ContestDetailFetching  // ← Protocol, not Service

    func fetchContestDetail() async {
        let state = try await detailFetcher.fetchContestActionState(contestId: contestId)
        self.actionState = state  // ← Direct publish, no transformation
    }
}
```

---

## View Template

```swift
struct ContestDetailView: View {
    @EnvironmentObject var vm: ContestDetailViewModel

    var body: some View {
        if let state = vm.actionState {
            if state.actions.canJoin {
                Button("Join") {
                    Task { await vm.joinContest() }  // ← ViewModel method
                }
            }
        }
    }
}
```

---

## Test Template (ViewModel)

```swift
@MainActor
final class ContestDetailViewModelTests: XCTestCase {
    func testFetch() async {
        let mock = MockContestDetailFetching(return: .stub())
        let vm = ContestDetailViewModel(contestId: UUID(), detailFetcher: mock)
        //                                                       ↑ Protocol mock
        await vm.fetchContestDetail()
        XCTAssertEqual(vm.actionState, .stub())  // ← Domain type
    }
}
```

---

## Test Template (Service)

```swift
final class ContestDetailServiceTests: XCTestCase {
    func testMaps() async throws {
        let contract = ContestDetailResponseContract.stub()
        let service = ContestDetailService(fetcher: { contract })

        let domain = try await service.fetchContestActionState(contestId: UUID())

        XCTAssertEqual(domain.contestId, contract.contest_id)  // ← Verify mapping
    }
}
```

---

## Violation Scanner (Copy-Paste Into Build)

```bash
#!/bin/bash
# Fail the build if violations found

ERRORS=0

# Scan for DTO imports in ViewModels
grep -r "import.*DTO\|import.*ResponseContract" ios-app/PlayoffChallenge/*/ViewModels/ 2>/dev/null && ((ERRORS++))

# Scan for concrete service imports in ViewModels
grep -r "private let.*: .*Service[^Protocol]" ios-app/PlayoffChallenge/*/ViewModels/*.swift 2>/dev/null | grep -v "protocol" && ((ERRORS++))

# Scan for APIService direct calls in Views
grep -r "APIService\.shared\." ios-app/PlayoffChallenge/*/Views/ 2>/dev/null && ((ERRORS++))

if [ $ERRORS -gt 0 ]; then
    echo "❌ Architecture violations detected"
    exit 1
fi
echo "✅ Architecture check passed"
```

---

## PR Review Checklist (90 seconds)

```
DOES THIS PR:

☐ Add @Published with Domain type (not DTO)?
☐ Inject only Protocols, never concrete Service?
☐ Return Domain from service protocol?
☐ Map Contract → Domain strictly (no inference)?
☐ Include ViewModel + Service + Domain tests?
☐ Avoid optional fields in Domain without reason?

IF ANY BOX IS EMPTY: REQUEST CHANGES
```

---

## Mental Model

```
Backend sends JSON → Contract (DTO) → Service decodes & maps → Domain → ViewModel publishes → View renders
                ↑                                                 ↑
            Network boundary                            Application boundary
          (can be weird, optional)                    (always strict, required)
```

---

## Common Questions

| Q | A |
|---|---|
| "Can I add an optional field?" | Only if backend sends it optional AND View handles nil. Usually: no. |
| "Can I use the concrete Service?" | Only in tests as mock. Everywhere else: protocol only. |
| "Can Views call Services?" | No. Always through ViewModel. |
| "Can ViewModels call other ViewModels?" | No. Share a service dependency instead. |
| "What if the backend changes?" | Update Contract, add migration in Service, tests verify mapping. |

---

## Files To Know

| File | Purpose |
|------|---------|
| `ios-app/ARCHITECTURE.md` | Full spec (read this) |
| `ios-app/ARCHITECTURE_ENFORCEMENT.md` | Build checks, CI/CD rules |
| `core/Sources/core/Contracts/` | Network DTOs (single source of truth) |
| `ios-app/*/Protocols/` | Service protocols (boundaries) |
| `ios-app/*/Services/` | Service implementations (internal) |
| `ios-app/*/ViewModels/` | ViewModel state owners |

---

**Status**: ENFORCED
**Last Updated**: 2026-02-23
**Print This**. Laminate It. Reference It Daily.
