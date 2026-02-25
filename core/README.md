# Core (Swift Package) — Architecture, Build & Test Rules

This directory contains the Swift Package that powers shared business logic
for the iOS client.

The Core package is the authoritative client-side domain layer.

It is the single source of truth for:

- Domain models
- Strategy dispatch
- Deterministic scoring logic (presentation-safe only)
- ViewModel state logic
- Contract decoding
- Business rule invariants
- Contest lifecycle representation (client interpretation only)

────────────────────────────────────────
Authoritative Principles

Core is:

- Deterministic
- Contract-driven
- Immutable-first
- Environment-agnostic
- Free of side effects where possible

Core is NOT:

- A networking layer
- A persistence layer
- A Stripe integration layer
- A feature flag system
- An environment switchboard
- A mutation engine

No external service logic belongs here.

────────────────────────────────────────
Build

Always verify the package builds before committing:

    swift build

Build failures block merge.

────────────────────────────────────────
Run Tests

Run full suite:

    swift test

Run specific tests:

    swift test --filter TestNameHere

`swift test` is the authoritative signal.
Xcode test runs are not the source of truth.

────────────────────────────────────────
Test Discipline

You MUST run tests if you change:

- Domain models
- Contract DTO decoding
- Strategy keys
- ViewModel logic
- Scoring rules
- Lifecycle state representations
- Any invariant enforcement

If tests fail:

Stop.
Fix.
Do not bypass.

Core exists to protect determinism.

────────────────────────────────────────
Architecture Enforcement

Rules:

- No DTO types exposed to SwiftUI views
- No concrete service types inside ViewModels
- No optional domain fields unless explicitly allowed by backend contract
- No fabricated domain properties
- No environment branching
- No mutation without explicit return state

Mapping order must remain:

DTO → Domain → ViewModel → View

Never reverse this flow.

────────────────────────────────────────
Contest & Financial Alignment

Core reflects:

- Contest lifecycle states
- Settlement result presentation
- Leaderboard ordering rules
- Tier-based lineup configuration
- Immutable completion behavior

Core does NOT execute:

- Wallet debits
- Ledger mutations
- Settlement jobs
- Stripe operations

It only reflects the authoritative backend state.

────────────────────────────────────────
Golden Rule

Core is a stability layer.

If a change affects:

- Contest lifecycle representation
- Scoring determinism
- Financial display calculations
- Domain invariants

You must run:

    swift test

Before committing.

Core protects revenue integrity.
