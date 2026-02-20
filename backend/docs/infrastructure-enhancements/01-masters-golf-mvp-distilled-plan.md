# 16 — Masters Golf Contest Type (MVP Distilled Plan)

## Objective

Ship the Masters golf contest type in April with:

- Backend authoritative contract
- Deterministic golf engine
- Pure presentation iOS client
- Zero client-side scoring or payout logic
- No architectural rewrites
- No UI redesign
- No gold plating

This document defines the minimum viable implementation required for launch.

---

# 1. Scope Definition (MVP Only)

## In Scope

- Single Masters-format tournament
- Stroke-play cumulative scoring
- Fixed roster size (config-driven)
- Single tournament lock (no round-based swaps)
- Backend-calculated leaderboard
- Backend-calculated payouts
- Schema-driven leaderboard rendering
- Action-flag-driven UI state
- Unit tests only (no simulator dependency)

## Explicitly Out of Scope

- Round-based lineup edits
- Live hole-by-hole UI
- Salary cap enforcement beyond display
- Multi-entry power features
- Dynamic layout engine
- Real-time updates
- Cross-sport abstraction refactors
- iOS scoring logic

---

# 2. Backend Responsibilities

## 2.1 Tournament Config

Tournament must be fully config-driven:

- provider_event_id
- ingestion_endpoint
- event_start_date
- event_end_date
- round_count = 4
- cut_after_round = 2 (nullable allowed)
- leaderboard_schema_version = 1
- roster_size (required)
- payout structure (final amounts only)
- hash for immutability

Once LIVE:
- Config immutable
- No rule drift allowed

---

## 2.2 Golf Engine

Engine responsibilities:

- Validate config
- Select field deterministically
- Apply stroke-play cumulative scoring
- Return stroke totals only
- Deterministic replay guaranteed

Engine must NOT:

- Rank players
- Compute payouts
- Trigger lifecycle transitions
- Call Stripe
- Send emails
- Persist side effects

---

## 2.3 Settlement Layer

Settlement:

- Consumes stroke totals
- Computes rank
- Applies tie resolution
- Computes payout per entry
- Writes leaderboard rows
- Pure function behavior (replay safe)

---

## 2.4 Presentation Contract

Contest detail must include:

- type
- actions
- payout_table
- roster_config

Leaderboard endpoint must include:

- contest_id
- contest_type
- leaderboard_state
- column_schema
- rows
- pagination

All amounts final.
All flags derived server-side.
No client inference permitted.

---

# 3. iOS Responsibilities (Presentation Only)

## 3.1 No Business Logic

Remove:

- Client-side scoring
- Client-side payout calculation
- Client-side rank computation
- Status string inference

---

## 3.2 Leaderboard Rendering

- Render from column_schema
- No hardcoded columns
- No sorting
- No rank fabrication
- Backend row order preserved

Column types supported:

- ordinal
- string
- numeric
- currency
- percentage
- date
- unknown → string fallback

---

## 3.3 State Handling

UI state derived only from:

- actions flags
- leaderboard_state

Never from:

- contest.status
- entries.isEmpty
- index-based ranking
- local inference

---

## 3.4 Masters Lineup Flow

MVP behavior:

- Pick X golfers (config-driven)
- No positional logic
- No salary enforcement blocking submit
- Lock at tournament start
- Read-only after lock

---

# 4. Required Unit Tests

## Backend

- Config validation failures explicit
- Deterministic scoring replay
- Tie resolution correctness
- Payout reconciliation invariant
- Join idempotency

## iOS

- Codable decoding strict
- No sorting in leaderboard
- Rank not inferred from index
- Action flags drive UI state
- All column types render correctly
- Unknown column types safe
- Leaderboard_state drives UI states

No simulator tests allowed.

---

# 5. Launch Exit Criteria

Masters MVP is shippable when:

- Config immutable after LIVE
- Deterministic scoring verified
- Payout reconciliation passes
- No client-side business logic remains
- Leaderboard fully schema-driven
- All unit tests passing
- No status string inference
- No rank fabrication
- No hardcoded leaderboard columns

---

# 6. Definition of Done

✓ Backend authoritative  
✓ iOS presentation only  
✓ Determinism verified  
✓ Drift-resistant contract  
✓ Masters contest can run end-to-end  
✓ No App Store dependency for future golf contests  

---

# Final Principle

Backend computes.
iOS renders.
Determinism always.
No silent logic anywhere.

