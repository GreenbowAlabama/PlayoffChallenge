# Handoff: web-admin Admin Endpoint Contract and UI Enhancement

**Scope: web-admin**

---

## Objective

Establish a strict, safe admin UI surface for web-admin by:
1. Classifying all existing admin endpoints
2. Exposing only 4 bounded capabilities in the UI
3. Removing dangerous endpoints entirely
4. Implementing guardrails for all UI-exposed actions

---

## Confirmed Assumptions

- web-admin is admin-only; `users.is_admin = true` is always preserved
- The API is the source of truth; the UI must not invent behavior
- Only 4 high-level capabilities may be UI-exposed
- Per-user mutations are forbidden in the UI
- Score deletion and backfill endpoints are unacceptable risk

---

## Critical Finding: Missing Endpoints

Two of the 4 required capabilities have **no corresponding API endpoint**:

| Capability | API Status |
|------------|------------|
| Non-admin user cleanup (bulk) | **DOES NOT EXIST** — only per-user DELETE exists |
| Non-admin pick cleanup (bulk) | **DOES NOT EXIST** — no picks admin endpoint found |

**Worker must create these endpoints before UI can expose them.**

---

## Complete Admin Endpoint Inventory

### Classification Key
- **Type**: READ / DESTRUCTIVE / SYSTEM
- **Disposition**: UI-EXPOSED / API-ONLY / DELETE-ENTIRELY

---

### UI-EXPOSED (4 Capabilities)

These endpoints support the allowed UI surface.

#### Capability 1: Contest/Week Reset and Activation

| Method | Path | Type | Notes |
|--------|------|------|-------|
| POST | /api/admin/set-active-week | DESTRUCTIVE | Sets active week state |
| POST | /api/admin/update-week-status | DESTRUCTIVE | Updates week active/inactive |
| POST | /api/admin/update-current-week | DESTRUCTIVE | Changes current playoff week |
| POST | /api/admin/process-week-transition | DESTRUCTIVE | Advances contest to next week |

**UI Requirement**: Compose these into a single "Week Management" panel with explicit confirmation.

#### Capability 2: Non-Admin User Cleanup

| Method | Path | Type | Notes |
|--------|------|------|-------|
| — | **ENDPOINT MUST BE CREATED** | — | POST /api/admin/users/cleanup |

**Required behavior**: Delete all users where `is_admin = false`. Must preserve admin users.

#### Capability 3: Non-Admin Pick Cleanup

| Method | Path | Type | Notes |
|--------|------|------|-------|
| — | **ENDPOINT MUST BE CREATED** | — | POST /api/admin/picks/cleanup |

**Required behavior**: Delete all picks belonging to non-admin users. Must preserve admin picks.

#### Capability 4: Read-Only Game State Inspection

| Method | Path | Type | Notes |
|--------|------|------|-------|
| GET | /api/admin/users | READ | List all users |
| GET | /api/admin/cache-status | READ | View cache state |
| GET | /api/admin/position-requirements | READ | View position rules |
| GET | /api/admin/check-espn-ids | READ | View ESPN ID mapping status |

**Note**: PUT /api/admin/settings exists but mutations are API-ONLY.

---

### API-ONLY (Never UI-Exposed)

These endpoints remain in the API but must never appear in web-admin UI.

#### Per-User Mutations

| Method | Path | Type | Reason |
|--------|------|------|--------|
| PUT | /api/admin/users/:id/payment | DESTRUCTIVE | Per-user mutation forbidden |
| DELETE | /api/admin/users/:id | DESTRUCTIVE | Per-user mutation forbidden |

#### Sync Operations

| Method | Path | Type | Reason |
|--------|------|------|--------|
| POST | /api/admin/sync-espn-ids | DESTRUCTIVE | System operation |
| POST | /api/admin/sync-players | DESTRUCTIVE | System operation |
| POST | /api/admin/populate-image-urls | DESTRUCTIVE | System operation |
| POST | /api/admin/update-live-stats | DESTRUCTIVE | System operation |
| PUT | /api/admin/players/:playerId/espn-id | DESTRUCTIVE | Per-player mutation |

#### Compliance and Diagnostics

| Method | Path | Type | Reason |
|--------|------|------|--------|
| GET | /api/admin/compliance/state-distribution | READ | Diagnostic only |
| GET | /api/admin/compliance/ip-mismatches | READ | Diagnostic only |
| GET | /api/admin/compliance/signup-attempts | READ | Diagnostic only |

#### Settings and Rules Mutation

| Method | Path | Type | Reason |
|--------|------|------|--------|
| PUT | /api/admin/settings | DESTRUCTIVE | Config mutation |
| PUT | /api/admin/position-requirements/:id | DESTRUCTIVE | Rules mutation |
| PUT | /api/admin/rules/:id | DESTRUCTIVE | Rules mutation |
| PUT | /api/admin/terms | DESTRUCTIVE | Legal mutation |

#### Legacy/Ambiguous

| Method | Path | Type | Reason |
|--------|------|------|--------|
| POST | /admin/refresh-week | DESTRUCTIVE | Missing /api prefix; review for deletion |

#### Auth

| Method | Path | Type | Reason |
|--------|------|------|--------|
| POST | /api/admin/auth/apple | SYSTEM | Auth flow; not user-invoked |

---

### DELETE-ENTIRELY (Must Be Removed from API)

These endpoints represent unacceptable risk and must be deleted.

| Method | Path | Type | Risk |
|--------|------|------|------|
| DELETE | /api/admin/scores/teams/:weekNumber | DESTRUCTIVE | Selective score destruction |
| DELETE | /api/admin/scores/:userId/:weekNumber | DESTRUCTIVE | Per-user score destruction |
| POST | /api/admin/backfill-playoff-stats | DESTRUCTIVE | Historical data replay |
| POST | /api/admin/initialize-week-scores | DESTRUCTIVE | Partial recomputation |
| POST | /api/admin/migrate-add-image-url | DESTRUCTIVE | One-off migration artifact |

**Worker instruction**: Remove these route handlers entirely from server.js.

---

## UI Layout Specification

### Panel Structure

```
┌─────────────────────────────────────────────────────────┐
│  GAME STATE (Read-Only)                                 │
│  ─────────────────────────────────────────────────────  │
│  Current Week: [value]    Season: [value]               │
│  Week Active: [yes/no]    Users: [count]                │
│  Cache Status: [healthy/stale]                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  WEEK MANAGEMENT                                        │
│  ─────────────────────────────────────────────────────  │
│  [Set Active Week]  [Process Week Transition]           │
│                                                         │
│  ⚠️ These actions affect all users                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ⛔ DESTRUCTIVE ACTIONS                                 │
│  ─────────────────────────────────────────────────────  │
│  All actions below permanently delete data.             │
│  Admin users and admin picks are always preserved.      │
│                                                         │
│  [Clear Non-Admin Users]    [Clear Non-Admin Picks]     │
└─────────────────────────────────────────────────────────┘
```

---

## Guardrails Per Capability

### Capability 1: Week Management

| Action | Guardrail |
|--------|-----------|
| Set Active Week | Dropdown selection + confirm dialog |
| Process Week Transition | Two-step confirm: "This will advance all users to week N" |

### Capability 2: Clear Non-Admin Users

| Step | Requirement |
|------|-------------|
| 1 | Display count of users to be deleted |
| 2 | Require typed confirmation: `DELETE USERS` |
| 3 | Show explicit message: "Admin users will NOT be deleted" |
| 4 | Disable button for 3 seconds after modal opens |

### Capability 3: Clear Non-Admin Picks

| Step | Requirement |
|------|-------------|
| 1 | Display count of picks to be deleted |
| 2 | Require typed confirmation: `DELETE PICKS` |
| 3 | Show explicit message: "Admin picks will NOT be deleted" |
| 4 | Disable button for 3 seconds after modal opens |

### Capability 4: Game State Inspection

| Requirement |
|-------------|
| Read-only display; no mutation controls |
| Auto-refresh every 30 seconds or manual refresh button |

---

## Validation Steps (Ordered)

1. **Verify endpoint removal**: Confirm DELETE-ENTIRELY endpoints are removed from server.js
2. **Verify new endpoints exist**: Confirm /api/admin/users/cleanup and /api/admin/picks/cleanup are created
3. **Verify admin preservation**: Call cleanup endpoints and confirm `is_admin = true` users/picks remain
4. **Verify UI isolation**: Confirm no API-ONLY endpoints are callable from web-admin
5. **Verify guardrails**: Attempt destructive action; confirm typed confirmation is required
6. **Verify read-only panel**: Confirm game state panel has no mutation controls

---

## Risks and Edge Cases

| Risk | Mitigation |
|------|------------|
| Admin accidentally deletes themselves | Cleanup endpoints explicitly filter `is_admin = false` |
| UI calls wrong endpoint | UI must use capability-specific wrapper functions, not raw fetch |
| Stale UI shows wrong state | Read-only panel auto-refreshes; actions refresh state on completion |
| Typed confirmation bypassed | Disable submit button until exact match |

---

## Worker Instructions

### Phase 1: API Cleanup

1. Delete the following route handlers from `backend/server.js`:
   - DELETE /api/admin/scores/teams/:weekNumber (line ~2284)
   - DELETE /api/admin/scores/:userId/:weekNumber (line ~2316)
   - POST /api/admin/backfill-playoff-stats (lines ~1707 and ~2009)
   - POST /api/admin/initialize-week-scores (line ~1942)
   - POST /api/admin/migrate-add-image-url (line ~1426)

2. Create two new endpoints in `backend/server.js`:
   - POST /api/admin/users/cleanup
     - Delete from users WHERE is_admin = false
     - Return count of deleted users
   - POST /api/admin/picks/cleanup
     - Delete from picks WHERE user_id IN (SELECT id FROM users WHERE is_admin = false)
     - Return count of deleted picks

### Phase 2: web-admin UI

1. Create admin dashboard with 3 panels as specified
2. Implement typed confirmation modal component
3. Wire UI-EXPOSED endpoints only
4. Ensure no API-ONLY endpoints are imported or callable

### Phase 3: Verification

1. Run validation steps in order
2. Confirm all exit criteria pass

---

## Exit Criteria

- [ ] 5 dangerous endpoints removed from API
- [ ] 2 new cleanup endpoints created and functional
- [ ] web-admin exposes exactly 4 capabilities
- [ ] All destructive actions require typed confirmation
- [ ] Admin users/picks survive all cleanup operations
- [ ] No API-ONLY endpoints accessible from UI
