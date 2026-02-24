# CLAUDE.md

## Purpose
This repository implements a fantasy sports platform that supports multiple contest types running concurrently. The platform is contest-agnostic. Individual game modes plug into it.

## Primary goals
- Support multiple contests at the same time
- Support multiple contest types over time
- Minimize manual admin intervention
- Keep scoring deterministic and replayable

## Non-negotiable platform rules

### 1. Multi-contest is first-class
- Never assume a single active contest
- All reads and writes must be scoped by contest_id
- Global state tied to one contest is forbidden

### 2. Contest types are pluggable
- Platform code must not assume sport, scoring rules, or entry shape
- Contest logic defines what an entry contains
- Platform enforces lifecycle, isolation, and permissions only

### 3. No manual admin steps
- Contest lifecycle transitions must be automated
- Locking, scoring, and state changes are data-driven
- Admin tooling is for observability, not control

### 4. Deterministic scoring
- Scoring must be repeatable from the same inputs
- Re-runs must not create duplicate side effects
- One contest’s scoring must not affect another

### 5. Isolation is mandatory
- A failure in one contest must not break others
- Services must treat contest_id as a hard boundary

## Contest join architecture

Contests use a two-phase join model. The phases are intentionally separate.

### Phase 1: Token resolution (pre-auth, read-only)
- `GET /api/custom-contests/join/:token` (canonical)
- `GET /api/join/:token` (legacy delegate, deprecated)
- Service: `customContestService.resolveJoinToken`
- No user context, no mutations, no capacity checks
- Returns contest metadata for onboarding and deep links

### Phase 2: Participant join (authenticated, mutating)
- `POST /api/custom-contests/:id/join`
- Service: `customContestService.joinContest`
- This is the only place participants are created

### Participant enforcement invariants
- A user can only join a contest once (DB unique constraint on `contest_participants`)
- A contest cannot exceed capacity (`contest_instances.max_entries`, NULL = unlimited)
- Only open contests can be joined
- Organizer is always a participant (auto-joined on publish)
- Concurrent joins are serialized via `SELECT ... FOR UPDATE`

### Error mapping (DB is the arbiter)
- PG 23505 (unique violation) -> ALREADY_JOINED
- Capacity CTE returns 0 rows -> CONTEST_FULL
- No application-side duplicate checks without DB backing
- No silent capacity overflow

### Deprecated paths
- `contestService.js` throws on import (references non-existent tables)
- Legacy `/api/join/:token` delegates to canonical route only

## Development expectations for AI agents
- Do not explore the entire repo by default
- Read only what is necessary for the task
- Ask before making assumptions about architecture
- Stop after proposing changes and wait for user review
- Never silently expand scope

## Testing and changes
- Prefer small, contained diffs
- Tests should fail before they pass
- Do not update or weaken tests to satisfy code
- If behavior contradicts this file, the file may be wrong and should be updated explicitly

## Scope of this file
- This file defines platform-level constraints only
- Service-specific rules belong in service-level CLAUDE.md files when they exist
- This file should stay short and reflect current reality