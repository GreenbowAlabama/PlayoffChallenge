# Iteration 04 — Contract Source of Truth

## Objective
Define immutable request/response contracts across:
- Backend infrastructure
- iOS client
- Future consumers

Contracts must be:
- Explicit
- Version-aware
- Decodable-safe
- Backend authoritative
- Drift-resistant

---

## Governance Rules

1. Backend defines contract.
2. iOS mirrors contract exactly.
3. No silent field defaults.
4. No optional fields unless explicitly documented.
5. No client-side fabrication of backend state.
6. Enum values must match backend exactly.
7. Contract decoding failures must fail loudly.

---

## Required Sections Per Contract

For each endpoint document:

- Endpoint path
- HTTP method
- Request schema
- Response schema
- Field types
- Enum values
- Required vs optional
- Example payload
- Failure payload shape
- Version notes

---

## Drift Prevention

- Any contract change requires:
  - Backend PR
  - Schema snapshot update
  - iOS decoding update
  - Documentation update in this folder

- CI should fail if:
  - Backend changes contract shape without iOS alignment
  - Enum values diverge
  - Required fields become optional silently

---

## Ownership

Backend: Authoritative schema
iOS: Strict decoder enforcement
Docs: Single source of truth reference

