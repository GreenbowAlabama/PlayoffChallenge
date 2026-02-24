# iOS Architecture Documentation Index

**VALIDATION 4 — Complete Reference Suite**

Start here. Navigate by role.

---

## For Developers (New to the Codebase)

1. **Read**: [`ARCHITECTURE_QUICK_REF.md`](ARCHITECTURE_QUICK_REF.md) (5 min)
   - One-page rules, templates, checklist
   - Laminate this, keep at desk
   - All you need to know to write correct code

2. **Reference**: [`DOMAIN_TYPES.md`](DOMAIN_TYPES.md) (10 min, as needed)
   - Every Domain type defined in Core
   - How to map Contract → Domain
   - Usage examples and stubs

3. **Deep Dive**: [`ARCHITECTURE.md`](ARCHITECTURE.md) (30 min, once)
   - Full specification with justification
   - Layer diagram, allowed directions, forbidden patterns
   - Definition of Done checklist

---

## For Code Reviewers (PR Approval)

1. **Use**: [`ARCHITECTURE_QUICK_REF.md`](ARCHITECTURE_QUICK_REF.md) (90 seconds per PR)
   - 90-second checklist before approval
   - Templates to compare against
   - Common violations to spot

2. **Enforce**: [`ARCHITECTURE_ENFORCEMENT.md`](ARCHITECTURE_ENFORCEMENT.md) (as needed)
   - Detailed violation fixes
   - Test patterns to verify
   - Build checks to fail on violations

3. **Reference**: [`ARCHITECTURE.md`](ARCHITECTURE.md) (for disputes)
   - Authority document
   - Why each rule exists
   - Edge cases and special cases

---

## For Architects (Design Decisions)

1. **Authority**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
   - Complete specification
   - Rationale for each constraint
   - Layer isolation, protocol boundaries, testing

2. **Enforcement**: [`ARCHITECTURE_ENFORCEMENT.md`](ARCHITECTURE_ENFORCEMENT.md)
   - How to detect violations
   - Build-time checks, CI/CD integration
   - Metrics to track health

3. **Types**: [`DOMAIN_TYPES.md`](DOMAIN_TYPES.md)
   - Canonical list of Domain types
   - Migration path for changes
   - Import patterns

---

## For CI/CD / Build Engineers

1. **Setup**: [`ARCHITECTURE_ENFORCEMENT.md`](ARCHITECTURE_ENFORCEMENT.md) → "Build-Time Checks"
   - Copy-paste scripts
   - Forbidden import detection
   - Swift build verification
   - Optional field detection

2. **Testing**: `ArchitectureTests.swift` in Core package
   - Verify Contract decode failures
   - Verify Contract → Domain mapping
   - Verify no optional Domain fields

3. **Monitoring**: [`ARCHITECTURE_ENFORCEMENT.md`](ARCHITECTURE_ENFORCEMENT.md) → "Metrics & Monitoring"
   - Track violations per week
   - Protocol injection rate
   - Domain type coverage

---

## Document Navigation

### By Topic

| Topic | Document | Section |
|-------|----------|---------|
| **Rules at a glance** | Quick Ref | Dependency Diagram |
| **Layer isolation** | ARCHITECTURE | Layer Architecture |
| **Protocol boundaries** | ARCHITECTURE | Protocol Boundary Rules |
| **Forbidden patterns** | ARCHITECTURE, Quick Ref | Forbidden Patterns |
| **Domain types** | DOMAIN_TYPES | Canonical Domain Types |
| **Service mapping** | DOMAIN_TYPES, ARCHITECTURE | Mapping Rules |
| **Testing patterns** | ARCHITECTURE, Enforcement, Quick Ref | Test/Build Rules |
| **Build checks** | ENFORCEMENT | Build-Time Checks |
| **PR review** | Quick Ref, ENFORCEMENT | PR Review Checklist |
| **Violation fixes** | ENFORCEMENT | Common Violations & Fixes |
| **CI/CD setup** | ENFORCEMENT | Build-Time Checks |

### By Role

| Role | Start Here | Then Read |
|------|-----------|-----------|
| **Developer** | Quick Ref | ARCHITECTURE, DOMAIN_TYPES |
| **Reviewer** | Quick Ref | ENFORCEMENT, ARCHITECTURE |
| **Architect** | ARCHITECTURE | ENFORCEMENT, DOMAIN_TYPES |
| **DevOps** | ENFORCEMENT | ARCHITECTURE |

### By Scenario

| Scenario | Action | Reference |
|----------|--------|-----------|
| "I'm writing a ViewModel" | Use template | Quick Ref → ViewModel Template |
| "I'm creating a Service" | Follow pattern | DOMAIN_TYPES → Mapping from Contract |
| "I'm in a PR review" | 90-sec check | Quick Ref → PR Review Checklist |
| "Build failed, DTO found" | Fix violation | ENFORCEMENT → Common Violations #1 |
| "Need to add a Domain type" | Define in Core | DOMAIN_TYPES → Migration Path |
| "Writing a test" | Copy template | Quick Ref → Test Template |

---

## One-Minute Summary

```
📦 Contracts (DTO):          Defined in Core, network shape, endpoint-specific
   ↓ (Service decodes & maps)
🎯 Domain:                    Defined in Core, application model, immutable
   ↓ (ViewModel publishes)
🧠 ViewModel:                 Publishes Domain types only, injects Protocols only
   ↓ (View reads)
👁️ View:                      SwiftUI, reads Domain from ViewModel, no backend knowledge

Rules:
✅ Views → ViewModel → Protocol → Contract
❌ Never: DTO in ViewModel, Concrete Service in ViewModel, Optional Domain fields, Direct API calls in View

Tests:
✅ Mock Protocol, return Domain stubs
❌ Never: Mock concrete Service, return Contracts

Build:
✅ swift build + swift test in Core
❌ Never: Forbidden imports in ViewModels, Services returning DTOs
```

---

## Enforced Locations

All documentation is checked into the repository:

```
ios-app/
├── ARCHITECTURE.md                  (Full spec, 700 lines)
├── ARCHITECTURE_ENFORCEMENT.md      (Build checks, CI/CD, 400 lines)
├── ARCHITECTURE_QUICK_REF.md        (One-page reference, 200 lines)
├── DOMAIN_TYPES.md                  (Canonical types, 400 lines)
├── ARCHITECTURE_INDEX.md            (This file, navigation)
│
├── PlayoffChallenge/
│   ├── ViewModels/                  (Inject Protocols, publish Domain)
│   ├── Services/                    (Implement Protocols, map Contract→Domain)
│   ├── Protocols/                   (Return Domain types)
│   └── Views/                       (Consume Domain via ViewModel)
│
└── Tests/
    └── *Tests.swift                 (Mock Protocols, test Domain mapping)
```

---

## Key Principles (Memorize)

1. **Core is authoritative** — All Domain types defined there, iOS doesn't invent
2. **Layer isolation** — Views depend on ViewModels, ViewModels depend on Protocols, Protocols depend on nothing
3. **Protocol-first injection** — All service dependencies injected as Protocols, never concrete types
4. **Strict mapping** — Contract → Domain mapping is one-way, no inference, backend truth preserved
5. **Domain immutability** — Never optional fields, never fabricated fields, never inferred state
6. **No DTO exposure** — ViewModels publish Domain, Views read Domain, Contracts never leave Services
7. **Testability via Protocol** — All services mockable via Protocol, enabling isolation and repeatability

---

## Troubleshooting

| Error | Root Cause | Fix | Reference |
|-------|-----------|-----|-----------|
| "DTO import in ViewModel" | Wrong dependency direction | Remove import, use protocol instead | Quick Ref #1 |
| "Concrete service in ViewModel" | Testing not possible | Change to `private let s: Protocol` | Quick Ref #2 |
| "Optional Domain field" | Backend uncertainty | Remove optional, fail decode if missing | DOMAIN_TYPES |
| "Build fails with violation" | Pre-commit hook | See error, run scanner, fix imports | ENFORCEMENT |
| "View sees Contract" | Layering broken | Move mapping to Service, publish Domain | ARCHITECTURE |
| "Service returns DTO" | Protocol not enforced | Change return type to Domain type | ARCHITECTURE |
| "Inferred state in ViewModel" | No backend trust | Use backend field directly, no logic | Quick Ref #5 |

---

## Change Log

| Date | Change | Version |
|------|--------|---------|
| 2026-02-23 | Initial release: ARCHITECTURE, ENFORCEMENT, QUICK_REF, DOMAIN_TYPES | VALIDATION 4 |

---

## Authority & Governance

- **Authority**: Architecture Lead
- **Enforced**: PR review, build-time checks, CI/CD gates
- **Review Frequency**: Quarterly (next: Q2 2026)
- **Exceptions**: None without written approval from Architecture Lead

---

## Getting Help

| Question | Answer | Reference |
|----------|--------|-----------|
| "What should I do here?" | Check Quick Ref templates | ARCHITECTURE_QUICK_REF.md |
| "Is this pattern OK?" | Check Forbidden Patterns | ARCHITECTURE.md |
| "How do I test this?" | Copy test template | Quick Ref → Test Templates |
| "Build failed, why?" | See Violation Detection | ARCHITECTURE.md |
| "Need to add a type?" | Follow Domain Types pattern | DOMAIN_TYPES.md → Migration Path |

---

**Read the Quick Ref first. Reference the others as needed. Review for every PR. Questions? Ask the Architecture Lead.**

---

**Document Version**: VALIDATION 4 Index
**Last Updated**: 2026-02-23
**Status**: Active, Enforced
**Next Review**: Q2 2026
