# Core (Swift Package) — Test & Build Rules

This directory contains the Swift Package that powers shared business logic
for the iOS client.

The core module is the single source of truth for:

- Strategy dispatch
- ViewModel logic
- Contract decoding
- Business rule invariants
- Deterministic scoring logic (client-side presentation only)

────────────────────────────────────────
Build

Always verify the package builds before committing:

    swift build

────────────────────────────────────────
Run Tests

Run the full suite:

    swift test

Run a specific test target:

    swift test --filter TestNameHere

────────────────────────────────────────
Rules

- Do NOT rely solely on Xcode test runs
- `swift test` is the source of truth
- All tests must pass before committing
- Do not skip failing tests
- Do not bypass failing invariants

────────────────────────────────────────
Architectural Principles

The iOS Core package:

- Contains no networking code
- Contains no persistence layer
- Contains no Stripe logic
- Contains no environment branching
- Contains no business mutations

It is:

- Deterministic
- Pure where possible
- Thin where required
- Contract-driven

All API responses are decoded strictly according to OpenAPI definitions.

No business logic should live inside SwiftUI views.

────────────────────────────────────────
Golden Rule

If a change modifies:

- Model structures
- Strategy keys
- Contract response shapes
- ViewModel logic

You must run:

    swift test

Before committing.

The core package is a stability layer, not a convenience layer.

